import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { recordLeadCreated } from "@/server/leads/stage-history";
import type { StageChangeSource } from "@/lib/types";

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en la primera etapa del pipeline; si lo tiene, se actualiza su
 * última actividad.
 */
export async function onLeadActivity(
  organizationId: string,
  contactId: string,
  at: Date
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(eq(schema.lead.contactId, contactId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({ lastActivityAt: at, updatedAt: new Date() })
      .where(eq(schema.lead.id, existing[0].id));
    return;
  }

  await createLeadForContact({ organizationId, contactId, at });
}

/**
 * Crea el lead de un contacto. Lo comparten el webhook (sin `stageId`: primera
 * etapa abierta) y la captura manual (con la etapa que elija el dueño). Vive en
 * un solo sitio a propósito: el cálculo de la posición, el `onConflictDoNothing`
 * sobre `lead_contact_uq` y el registro en la bitácora son lo bastante sutiles
 * como para que dos copias diverjan en el primer cambio.
 *
 * Devuelve `null` si el pipeline no tiene etapas abiertas — quien llama decide
 * si eso es un error que mostrar (captura manual) o un silencio aceptable
 * (webhook: jamás debe tumbar la ingesta de un mensaje).
 */
export async function createLeadForContact(input: {
  organizationId: string;
  contactId: string;
  stageId?: string;
  at?: Date;
  /** Quién dio de alta: el webhook es `sistema`, la captura manual `dueno`. */
  source?: StageChangeSource;
  actorUserId?: string | null;
}): Promise<{ id: string; stageId: string } | null> {
  const db = getDb();

  let stageId = input.stageId;
  if (!stageId) {
    const firstStage = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(
        and(
          eq(schema.pipelineStage.organizationId, input.organizationId),
          eq(schema.pipelineStage.kind, "open")
        )
      )
      .orderBy(asc(schema.pipelineStage.position))
      .limit(1);
    if (!firstStage[0]) return null;
    stageId = firstStage[0].id;
  }

  const maxPos = await db
    .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, input.organizationId),
        eq(schema.lead.stageId, stageId)
      )
    );

  const inserted = await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      stageId,
      position: (maxPos[0]?.max ?? -1) + 1,
      lastActivityAt: input.at ?? null,
    })
    .onConflictDoNothing({ target: [schema.lead.contactId] })
    .returning({ id: schema.lead.id, stageId: schema.lead.stageId });

  const creado = inserted[0];
  if (!creado) return null;

  // El nacimiento del lead es el primer evento del embudo: sin él, "prospectos
  // que entraron en el periodo" no se podría contar desde la bitácora. Va aquí
  // DENTRO y no en quien llama, porque hay dos caminos que crean leads y el
  // segundo que alguien agregue lo olvidaría. Y va tras comprobar `creado`
  // porque `onConflictDoNothing` no devuelve fila cuando otro webhook
  // simultáneo ganó la carrera — ese ya anotó el suyo.
  await recordLeadCreated({
    organizationId: input.organizationId,
    leadId: creado.id,
    contactId: input.contactId,
    stageId: creado.stageId,
    occurredAt: input.at,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? "sistema",
  });

  return creado;
}
