import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { herramientasEfectivas } from "@/lib/agent-roles";
import { moveLeadToStage } from "@/server/leads/stage-history";

/**
 * 038 — El cerebro mueve la etapa del lead (`POST /api/bot/stage`).
 *
 * Es la acción `move_stage` que se fue con el agente incluido (036), con
 * reglas más cortas que las del dueño:
 *
 *   - Solo hacia adelante y solo a etapas abiertas. Ganada dispara la
 *     conversión a Meta y cuenta como venta; perdida exige un motivo. Las dos
 *     son decisión de una persona. Hacia atrás haría mentir al embudo.
 *   - Solo con la herramienta `etapa` encendida en el perfil: el CRM la hace
 *     cumplir, no confía en que el cerebro la respete.
 *   - Nunca sobre una conversación que una persona tomó.
 *
 * El movimiento pasa por `moveLeadToStage`, la única puerta que escribe
 * `stage_id`: misma etapa = `changed: false` y sin evento.
 */

export type EtapaDelPipeline = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

/** Las abiertas que van después de la actual, en el orden del Pipeline. */
export function etapasSiguientes(
  stages: readonly EtapaDelPipeline[],
  currentStageId: string
): EtapaDelPipeline[] {
  const ordenadas = [...stages].sort((a, b) => a.position - b.position);
  const actual = ordenadas.findIndex((s) => s.id === currentStageId);
  if (actual < 0) return [];
  return ordenadas.filter((s, i) => i > actual && s.kind === "open");
}

/**
 * La etapa que pidió el cerebro: por id, luego por nombre tal cual (sin los
 * espacios de los lados) y luego sin distinguir mayúsculas. El modelo repite
 * el nombre que vio en el contexto, y a veces lo capitaliza a su manera.
 */
export function resolverEtapa<T extends { id: string; name: string }>(
  pedida: string,
  stages: readonly T[]
): T | null {
  const limpia = pedida.trim();
  if (!limpia) return null;
  return (
    stages.find((s) => s.id === limpia) ??
    stages.find((s) => s.name.trim() === limpia) ??
    stages.find((s) => s.name.trim().toLowerCase() === limpia.toLowerCase()) ??
    null
  );
}

export type ResultadoEtapa =
  | { ok: true; changed: boolean; lead: { id: string; stageName: string }; conversationId: string }
  | { ok: false; status: 404; code: "not_found" | "sin_lead"; message: string }
  | {
      ok: false;
      status: 409;
      code: "ai_paused" | "herramienta_apagada" | "etapa_no_permitida";
      message: string;
    }
  | { ok: false; status: 422; code: "etapa_desconocida"; message: string };

function listaParaElModelo(stages: readonly { name: string }[]): string {
  return stages.length
    ? `Puedes moverlo a: ${stages.map((s) => s.name).join(", ")}.`
    : "No hay etapas a las que puedas moverlo.";
}

export async function moverEtapaPorElCerebro(input: {
  organizationId: string;
  conversationId: string;
  stage: string;
}): Promise<ResultadoEtapa> {
  const db = getDb();
  const { organizationId } = input;

  const convRows = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const conv = convRows[0];
  if (!conv) {
    return { ok: false, status: 404, code: "not_found", message: "Conversación no encontrada" };
  }
  // Misma regla que `/api/bot/messages`: con una persona al frente, el
  // cerebro no toca la conversación.
  if (!conv.aiEnabled || conv.handoffAt) {
    return {
      ok: false,
      status: 409,
      code: "ai_paused",
      message: "La IA está en pausa en esta conversación",
    };
  }

  const perfiles = await db
    .select({ tools: schema.agentProfile.tools })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  // Sin perfil, como sin configurar: todas encendidas.
  if (!herramientasEfectivas(perfiles[0]?.tools).includes("etapa")) {
    return {
      ok: false,
      status: 409,
      code: "herramienta_apagada",
      message: "La herramienta «Mover de etapa» está apagada en el perfil del agente",
    };
  }

  const [leadRows, stages] = await Promise.all([
    db
      .select({ id: schema.lead.id, stageId: schema.lead.stageId })
      .from(schema.lead)
      .where(
        scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, conv.contactId))
      )
      .limit(1),
    db
      .select({
        id: schema.pipelineStage.id,
        name: schema.pipelineStage.name,
        position: schema.pipelineStage.position,
        kind: schema.pipelineStage.kind,
      })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId))
      .orderBy(asc(schema.pipelineStage.position)),
  ]);
  const lead = leadRows[0];
  if (!lead) {
    return { ok: false, status: 404, code: "sin_lead", message: "El contacto no tiene lead en el pipeline" };
  }

  const siguientes = etapasSiguientes(stages, lead.stageId);
  const destino = resolverEtapa(input.stage, stages);
  if (!destino) {
    return {
      ok: false,
      status: 422,
      code: "etapa_desconocida",
      message: `No existe la etapa «${input.stage.trim()}». ${listaParaElModelo(siguientes)}`,
    };
  }

  // Pedir la etapa en la que ya está no es un error: es un reintento, o el
  // modelo confirmando. La puerta lo contesta con `changed: false`.
  if (destino.id !== lead.stageId && !siguientes.some((s) => s.id === destino.id)) {
    return {
      ok: false,
      status: 409,
      code: "etapa_no_permitida",
      message: `No puedes mover al lead a «${destino.name}»: solo hacia adelante y a etapas abiertas. ${listaParaElModelo(siguientes)}`,
    };
  }

  const res = await moveLeadToStage({
    organizationId,
    leadId: lead.id,
    toStageId: destino.id,
    source: "bot",
    extra: { lastActivityAt: new Date() },
  });
  if (!res.ok) {
    // Solo si el lead o la etapa desaparecieron entre la lectura y el
    // movimiento (el dueño borró algo en ese instante).
    return { ok: false, status: 404, code: "sin_lead", message: "El lead o la etapa ya no existen" };
  }

  return {
    ok: true,
    changed: res.changed,
    lead: { id: res.lead.id, stageName: destino.name },
    conversationId: conv.id,
  };
}

/** Lo que el contexto le enseña al cerebro: a dónde puede mover al lead. */
export async function siguientesDelLead(
  organizationId: string,
  currentStageId: string
): Promise<{ id: string; name: string }[]> {
  const stages = await getDb()
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      position: schema.pipelineStage.position,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId));
  return etapasSiguientes(stages, currentStageId).map(({ id, name }) => ({ id, name }));
}
