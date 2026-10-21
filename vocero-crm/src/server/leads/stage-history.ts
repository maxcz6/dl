import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { LossReason, StageChangeSource } from "@/lib/types";
import { reportStageChange } from "@/server/attribution/conversions";

/**
 * La ÚNICA puerta que escribe `lead.stage_id`.
 *
 * Regla dura: mover un lead y registrar el movimiento son
 * la misma operación, en la misma transacción. Hoy hay cuatro caminos que
 * cambian de etapa (el dueño arrastra, la agenda avanza al reservar, el cerebro
 * por `POST /api/bot/stage`, la reubicación al borrar una etapa); si cada uno copiara el "anota el evento",
 * el quinto que alguien agregue lo olvidaría. Y olvidarlo NO truena: solo hace
 * que las gráficas mientan meses después.
 *
 * Un unit test de vigilancia (`tests/unit/stage-history-guard.test.ts`) escanea
 * `src/` y falla si aparece una escritura de `stageId` fuera de este archivo.
 * No lo "arregles" moviendo el UPDATE a otro lado: es un guardarraíl.
 */

type LeadRow = typeof schema.lead.$inferSelect;

export type MoveResult =
  | { ok: true; lead: LeadRow; changed: boolean }
  | {
      ok: false;
      reason: "lead_not_found" | "stage_not_found" | "loss_reason_required";
    };

export type MoveInput = {
  organizationId: string;
  leadId: string;
  toStageId: string;
  /** Posición dentro de la columna destino. */
  position?: number;
  /** Quién lo movió; NULL cuando no fue una persona. */
  actorUserId?: string | null;
  source: StageChangeSource;
  /** Obligatorio al ENTRAR a una etapa perdida. */
  lossReason?: LossReason | null;
  lossNote?: string | null;
  /** Por defecto, ahora. */
  occurredAt?: Date;
  /**
   * Otros campos del lead que se escriben en el MISMO update. Existe para que
   * el PATCH del Pipeline no tenga que hacer dos viajes cuando el dueño mueve
   * la tarjeta y toca el monto en la misma acción.
   */
  extra?: Record<string, unknown>;
};

export async function moveLeadToStage(input: MoveInput): Promise<MoveResult> {
  const db = getDb();
  const occurredAt = input.occurredAt ?? new Date();

  // 016: se anota aquí dentro y se reporta a Meta DESPUÉS del commit. Una
  // llamada de red dentro de la transacción la mantendría abierta mientras
  // Meta piensa, y una conversión jamás vale una transacción larga.
  let toStageKind: "open" | "won" | "lost" | null = null;

  const result = await db.transaction(async (tx) => {
    const leadRows = await tx
      .select({ lead: schema.lead, stage: schema.pipelineStage })
      .from(schema.lead)
      .leftJoin(
        schema.pipelineStage,
        eq(schema.lead.stageId, schema.pipelineStage.id)
      )
      .where(
        scoped(
          schema.lead.organizationId,
          input.organizationId,
          eq(schema.lead.id, input.leadId)
        )
      )
      .limit(1);

    const current = leadRows[0];
    if (!current) return { ok: false as const, reason: "lead_not_found" as const };

    const targetRows = await tx
      .select()
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          input.organizationId,
          eq(schema.pipelineStage.id, input.toStageId)
        )
      )
      .limit(1);

    const target = targetRows[0];
    if (!target) return { ok: false as const, reason: "stage_not_found" as const };

    const changed = current.lead.stageId !== target.id;
    toStageKind = target.kind;

    // El motivo se exige al ENTRAR a la etapa perdida. Reordenar una tarjeta
    // que ya estaba ahí no vuelve a preguntar.
    if (changed && target.kind === "lost" && !input.lossReason) {
      return { ok: false as const, reason: "loss_reason_required" as const };
    }

    const updated = await tx
      .update(schema.lead)
      .set({
        ...(input.extra ?? {}),
        stageId: target.id,
        ...(input.position !== undefined ? { position: input.position } : {}),
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.lead.organizationId,
          input.organizationId,
          eq(schema.lead.id, input.leadId)
        )
      )
      .returning();

    const leadRow = updated[0];
    if (!leadRow) return { ok: false as const, reason: "lead_not_found" as const };

    if (changed) {
      await tx.insert(schema.leadStageEvent).values({
        id: newId("leadStageEvent"),
        organizationId: input.organizationId,
        leadId: leadRow.id,
        contactId: leadRow.contactId,
        fromStageId: current.stage?.id ?? null,
        fromStageName: current.stage?.name ?? null,
        toStageId: target.id,
        toStageName: target.name,
        toStageKind: target.kind,
        occurredAt,
        actorUserId: input.actorUserId ?? null,
        source: input.source,
        approximate: false,
        lossReason: target.kind === "lost" ? input.lossReason ?? null : null,
        lossNote: target.kind === "lost" ? input.lossNote ?? null : null,
      });
    }

    return { ok: true as const, lead: leadRow, changed };
  });

  // 016 — Atribución: si esta instancia la tiene encendida, entrar a la etapa
  // que el negocio marcó como "lead calificado" o a una etapa ganada se le
  // reporta a Meta. Best-effort y ya fuera de la transacción: un fallo aquí
  // jamás puede costar el movimiento del lead, que ya está en firme.
  if (result.ok && result.changed && toStageKind !== null) {
    await reportStageChange({
      organizationId: input.organizationId,
      leadId: result.lead.id,
      contactId: result.lead.contactId,
      toStageId: result.lead.stageId,
      toStageKind,
    });
  }

  return result;
}

/**
 * Evento de nacimiento del lead. Sin él, el embudo no tendría de dónde arrancar
 * y "prospectos que entraron" no podría contarse desde la bitácora.
 *
 * Best-effort a propósito: quien lo llama viene de crear un lead (a veces desde
 * la ingesta de un mensaje de WhatsApp), y un fallo aquí jamás debe tumbar esa
 * ruta. El lead sin evento aparecería con su fecha de creación de todos modos.
 */
export async function recordLeadCreated(input: {
  organizationId: string;
  leadId: string;
  contactId: string;
  stageId: string;
  occurredAt?: Date;
  actorUserId?: string | null;
  source?: StageChangeSource;
}): Promise<void> {
  const db = getDb();
  const stage = await db
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        input.organizationId,
        eq(schema.pipelineStage.id, input.stageId)
      )
    )
    .limit(1);

  const s = stage[0];
  if (!s) return;

  await db.insert(schema.leadStageEvent).values({
    id: newId("leadStageEvent"),
    organizationId: input.organizationId,
    leadId: input.leadId,
    contactId: input.contactId,
    fromStageId: null,
    fromStageName: null,
    toStageId: s.id,
    toStageName: s.name,
    toStageKind: s.kind,
    occurredAt: input.occurredAt ?? new Date(),
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? "sistema",
    approximate: false,
    // Un lead no puede nacer perdido: el CHECK de la base lo permitiría solo
    // con motivo, y aquí nunca hay uno que capturar.
    lossReason: null,
    lossNote: null,
  });
}

/**
 * Reubicación masiva al eliminar una etapa. Un evento por lead: el embudo debe
 * poder explicar por qué 30 tarjetas cambiaron de columna el mismo minuto.
 */
export async function relocateLeadsFromStage(input: {
  organizationId: string;
  fromStageId: string;
  toStageId: string;
  actorUserId?: string | null;
}): Promise<number> {
  const db = getDb();
  const leads = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        input.organizationId,
        eq(schema.lead.stageId, input.fromStageId)
      )
    )
    .orderBy(asc(schema.lead.position));

  const stageRows = await db
    .select({ name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(
      scoped(
        schema.pipelineStage.organizationId,
        input.organizationId,
        eq(schema.pipelineStage.id, input.fromStageId)
      )
    )
    .limit(1);
  const fromName = stageRows[0]?.name ?? "una etapa eliminada";

  let moved = 0;
  for (const l of leads) {
    const res = await moveLeadToStage({
      organizationId: input.organizationId,
      leadId: l.id,
      toStageId: input.toStageId,
      actorUserId: input.actorUserId ?? null,
      source: "sistema",
      // Si el destino resulta ser la etapa perdida, el motivo no se puede
      // inventar pero tampoco puede faltar: se registra lo que de verdad pasó.
      lossReason: "otro",
      lossNote: `Reubicado al eliminar la etapa "${fromName}"`,
    });
    if (res.ok) moved += 1;
  }
  return moved;
}

/** El último motivo de pérdida registrado de un lead, si lo hay. */
export async function lastLossReason(
  organizationId: string,
  leadId: string
): Promise<{ reason: LossReason; note: string | null; at: Date } | null> {
  const db = getDb();
  const rows = await db
    .select({
      lossReason: schema.leadStageEvent.lossReason,
      lossNote: schema.leadStageEvent.lossNote,
      occurredAt: schema.leadStageEvent.occurredAt,
    })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        and(
          eq(schema.leadStageEvent.leadId, leadId),
          eq(schema.leadStageEvent.toStageKind, "lost")
        )
      )
    )
    .orderBy(asc(schema.leadStageEvent.occurredAt))
    .limit(50);

  const last = rows.filter((r) => r.lossReason).at(-1);
  if (!last?.lossReason) return null;
  return {
    reason: last.lossReason,
    note: last.lossNote,
    at: last.occurredAt,
  };
}
