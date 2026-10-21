import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  addDaysISO,
  isValidTimeZone,
  todayInTz,
  zonedWallClockToUtc,
} from "@/lib/time/slots";
import type { PeriodDto } from "@/lib/analytics";
import { DEFAULT_TIMEZONE } from "@/server/agenda/settings";

/**
 * 019 — El periodo consultado, resuelto en la zona del NEGOCIO.
 *
 * Con cortes en UTC, todo lo que pasa después de las 18:00 en México cae en el
 * día siguiente: el dueño compararía su lunes contra un lunes que no existe.
 * La zona sale de la agenda (`calendar_settings`), la misma que ya decide qué
 * es "hoy" para los huecos disponibles; sin agenda, la de por defecto.
 *
 * Se apoya en `lib/time/slots`, que la 015 ya usa para lo mismo y está
 * probado: una segunda forma de entender las zonas horarias dentro del mismo
 * repositorio sería la receta para que dos pantallas no coincidan en qué día
 * es hoy.
 */

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO = "Fechas inválidas: usa el formato AAAA-MM-DD";

/** Rango en instantes UTC + su equivalente del periodo anterior. */
export type ResolvedPeriod = {
  dto: PeriodDto;
  /** Inicio del primer día local, en UTC. */
  start: Date;
  /** Fin EXCLUSIVO: el instante en que empieza el día siguiente al `to`. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  timezone: string;
};

export class PeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodError";
  }
}

export async function businessTimezone(organizationId: string): Promise<string> {
  const rows = await getDb()
    .select({ timezone: schema.calendarSettings.timezone })
    .from(schema.calendarSettings)
    .where(eq(schema.calendarSettings.organizationId, organizationId))
    .limit(1);
  const tz = rows[0]?.timezone;
  // Una zona inválida guardada en la base no puede tumbar la pantalla entera:
  // se cae a la de por defecto, que es lo mismo que hace la agenda.
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Días de diferencia entre dos fechas de calendario. */
export function daysApart(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) /
      86_400_000
  );
}

function medianoche(isoDate: string, timezone: string): Date {
  const d = zonedWallClockToUtc(isoDate, "00:00", timezone);
  if (!d || Number.isNaN(d.getTime())) throw new PeriodError(FORMATO);
  return d;
}

/**
 * `from`/`to` son fechas de calendario (`YYYY-MM-DD`) INCLUSIVAS. Ausentes, los
 * últimos 30 días terminando hoy.
 */
export function resolvePeriod(input: {
  from?: string | null;
  to?: string | null;
  timezone: string;
  now?: Date;
}): ResolvedPeriod {
  const tz =
    input.timezone && isValidTimeZone(input.timezone)
      ? input.timezone
      : DEFAULT_TIMEZONE;
  const hoy = todayInTz(input.now ?? new Date(), tz);

  if (input.from && !ISO_DATE.test(input.from)) throw new PeriodError(FORMATO);
  if (input.to && !ISO_DATE.test(input.to)) throw new PeriodError(FORMATO);

  const to = input.to || hoy;
  const from = input.from || addDaysISO(to, -(DEFAULT_DAYS - 1));

  // "2026-02-31" pasa el patrón y no es una fecha.
  const valida = (d: string) =>
    new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (
    Number.isNaN(Date.parse(`${from}T00:00:00Z`)) ||
    Number.isNaN(Date.parse(`${to}T00:00:00Z`)) ||
    !valida(from) ||
    !valida(to)
  ) {
    throw new PeriodError(FORMATO);
  }
  if (daysApart(from, to) < 0) {
    throw new PeriodError("La fecha inicial va antes que la final");
  }

  const days = daysApart(from, to) + 1;
  if (days > MAX_DAYS) {
    throw new PeriodError(`El rango máximo es de ${MAX_DAYS} días`);
  }

  // El periodo anterior tiene la MISMA duración y termina justo antes: así la
  // comparación no mezcla un mes de 30 días con uno de 31.
  const previousTo = addDaysISO(from, -1);
  const previousFrom = addDaysISO(previousTo, -(days - 1));

  // Rangos con fin EXCLUSIVO: `< end` evita el clásico bug del último
  // milisegundo del día, que se cuenta dos veces o se pierde.
  const start = medianoche(from, tz);
  const end = medianoche(addDaysISO(to, 1), tz);

  return {
    dto: {
      from,
      to,
      previousFrom,
      previousTo,
      timezone: tz,
      // Más de 92 días en barras diarias es ilegible: se agrupa por mes.
      granularity: days > 92 ? "month" : "day",
      days,
    },
    start,
    end,
    previousStart: medianoche(previousFrom, tz),
    previousEnd: start,
    timezone: tz,
  };
}

/** Resuelve el periodo de la URL leyendo la zona del negocio. */
export async function periodFromRequest(
  organizationId: string,
  url: URL,
  now?: Date
): Promise<ResolvedPeriod> {
  const timezone = await businessTimezone(organizationId);
  return resolvePeriod({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    timezone,
    now,
  });
}

/** Mediana de una lista de números; `null` si está vacía. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
