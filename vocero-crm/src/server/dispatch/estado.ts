import { and, count, desc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { BrainDispatchDto } from "@/lib/brain-status";
import { leerConfigDespacho, type ConfigDespacho } from "@/server/brains/config";

/**
 * 021 — Lo que «Quién responde» enseña del despacho: a quién se le empuja,
 * cuándo llegó el último turno, cuál fue el último que no llegó y cuántos
 * esperan. Sale de la tabla, no de la memoria del proceso: sobrevive a un
 * reinicio, a diferencia de la «última llamada» de `/api/bot/*`.
 */

type Hechos = {
  lastDeliveredAt: Date | null;
  lastFailure: { at: Date; detail: string } | null;
  pending: number;
};

/** Pura: de la configuración y los hechos de la tabla, al DTO. */
export function dispatchDto(config: ConfigDespacho, hechos: Hechos): BrainDispatchDto {
  return {
    active: config.active,
    host: config.host,
    problem: config.active ? null : config.problem,
    lastDeliveredAt: hechos.lastDeliveredAt?.toISOString() ?? null,
    lastFailure: hechos.lastFailure
      ? { at: hechos.lastFailure.at.toISOString(), detail: hechos.lastFailure.detail }
      : null,
    pending: hechos.pending,
  };
}

const SIN_HECHOS: Hechos = { lastDeliveredAt: null, lastFailure: null, pending: 0 };

export async function estadoDelDespacho(
  organizationId: string
): Promise<BrainDispatchDto> {
  const config = leerConfigDespacho();
  // Sin variable no se le pregunta nada a la base: una instancia que no
  // despacha no paga tres consultas cada vez que se pinta la tarjeta.
  if (!config.active && config.host === null && config.problem === null) {
    return dispatchDto(config, SIN_HECHOS);
  }

  const db = getDb();
  const deLaOrg = (cond: SQL | undefined) =>
    scoped(schema.dispatch.organizationId, organizationId, cond);
  const [[entregado], [fallo], [vivos]] = await Promise.all([
    db
      .select({ at: schema.dispatch.updatedAt })
      .from(schema.dispatch)
      .where(deLaOrg(eq(schema.dispatch.status, "entregado")))
      .orderBy(desc(schema.dispatch.updatedAt))
      .limit(1),
    // Un fallo que costó el turno (caducó) o que sigue reintentándose. Uno que
    // se recuperó no cuenta: `marcarEntregado` limpia su `last_error`.
    db
      .select({ at: schema.dispatch.updatedAt, detail: schema.dispatch.lastError })
      .from(schema.dispatch)
      .where(
        deLaOrg(
          and(
            isNotNull(schema.dispatch.lastError),
            inArray(schema.dispatch.status, ["caducado_a_humano", "pendiente", "en_vuelo"])
          )
        )
      )
      .orderBy(desc(schema.dispatch.updatedAt))
      .limit(1),
    db
      .select({ n: count() })
      .from(schema.dispatch)
      .where(deLaOrg(inArray(schema.dispatch.status, ["pendiente", "en_vuelo"]))),
  ]);

  return dispatchDto(config, {
    lastDeliveredAt: entregado?.at ?? null,
    lastFailure: fallo?.detail ? { at: fallo.at, detail: fallo.detail } : null,
    pending: vivos?.n ?? 0,
  });
}
