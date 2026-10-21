/**
 * 015 — Helpers puros de tiempo para el motor de agenda.
 *
 * Regla de oro: los instantes viven en UTC. La zona horaria del negocio solo
 * sirve para (a) expandir el horario semanal, que es hora de PARED, y (b)
 * etiquetar para el cliente.
 *
 * Sin dependencias: todo se resuelve con `Intl` de la plataforma, que ya trae
 * la base de datos de zonas (verificado también en el contenedor Alpine de
 * producción: 418 zonas y formato es-MX correcto). Ver
 * specs/015-motor-agenda-universal/research.md D1.
 */

export type Interval = { start: string; end: string }; // "HH:mm" hora de pared

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type SlotUtc = { startUtc: string; endUtc: string };

export const WEEKDAYS: WeekdayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidInterval(iv: unknown): iv is Interval {
  if (typeof iv !== "object" || iv === null) return false;
  const { start, end } = iv as { start?: unknown; end?: unknown };
  return (
    typeof start === "string" &&
    typeof end === "string" &&
    HHMM.test(start) &&
    HHMM.test(end) &&
    start < end
  );
}

/** ¿El runtime conoce esta zona IANA? Evita guardar basura que rompa el motor. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset de la zona (minutos al este de UTC) EN un instante dado. Se formatea
 * el instante en la zona y se lee el resultado como si fuera UTC: la
 * diferencia es el offset vigente ahí, con DST ya aplicado.
 */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    // Intl puede devolver "24" a medianoche en algunos entornos.
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Hora de pared (`YYYY-MM-DD` + `HH:mm`) en una zona → instante UTC.
 *
 * Dos pasadas: la primera estima el offset, la segunda lo corrige cuando el
 * cambio de horario cae justo en ese punto. En una hora inexistente (salto de
 * primavera) devuelve un instante real usando el offset previo; en una hora
 * ambigua (retroceso) elige la primera ocurrencia. Nunca lanza.
 */
export function zonedWallClockToUtc(
  dayISODate: string,
  hhmm: string,
  tz: string
): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISODate);
  if (!day || !HHMM.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    h,
    m
  );
  const first = tzOffsetMinutes(new Date(guess), tz);
  let ts = guess - first * 60_000;
  const second = tzOffsetMinutes(new Date(ts), tz);
  if (second !== first) ts = guess - second * 60_000;
  return new Date(ts);
}

/** Día de la semana (mon..sun) de una fecha ISO en una zona dada. */
export function weekdayKeyOf(dayISODate: string, tz: string): WeekdayKey | null {
  // Mediodía: ningún offset del mundo lo empuja al día vecino.
  const noon = zonedWallClockToUtc(dayISODate, "12:00", tz);
  if (!noon) return null;
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(noon)
    .toLowerCase();
  const key = WEEKDAYS.find((d) => short.startsWith(d));
  return key ?? null;
}

/** Fechas ISO (YYYY-MM-DD) de cada día del rango [from, to] inclusive. */
export function eachDateInRange(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return out;
  // Tope defensivo: la ventana máxima configurable es de 60 días.
  for (let t = from, i = 0; t <= to && i < 400; t += 86_400_000, i++) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Fecha ISO (YYYY-MM-DD) de un instante en la zona del negocio. */
export function dayIsoInTz(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** Fecha ISO de "hoy" en la zona del negocio. */
export function todayInTz(now: Date, tz: string): string {
  return dayIsoInTz(now, tz);
}

/** Suma días a una fecha ISO (sin zona: es aritmética de calendario). */
export function addDaysISO(dayISODate: string, days: number): string {
  const ts = Date.parse(`${dayISODate}T00:00:00Z`);
  if (Number.isNaN(ts)) return dayISODate;
  return new Date(ts + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Expande los intervalos hábiles de UN día (hora de pared en tz) a slots UTC.
 * Avanza `slot + buffer` por paso y solo emite el slot si CABE completo dentro
 * del intervalo.
 */
export function expandWorkingDayToUtc(
  dayISODate: string,
  intervals: Interval[],
  tz: string,
  slotMinutes: number,
  bufferMinutes: number
): SlotUtc[] {
  const out: SlotUtc[] = [];
  const step = slotMinutes + Math.max(0, bufferMinutes);
  if (slotMinutes <= 0 || step <= 0) return out;

  for (const iv of intervals) {
    const start = zonedWallClockToUtc(dayISODate, iv.start, tz);
    const end = zonedWallClockToUtc(dayISODate, iv.end, tz);
    if (!start || !end || end <= start) continue;

    for (
      let t = start.getTime(), guard = 0;
      t + slotMinutes * 60_000 <= end.getTime() && guard < 500;
      t += step * 60_000, guard++
    ) {
      out.push({
        startUtc: new Date(t).toISOString(),
        endUtc: new Date(t + slotMinutes * 60_000).toISOString(),
      });
    }
  }
  return out;
}

/** ¿Se solapan [aStart,aEnd) y [bStart,bEnd)? */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return (
    Date.parse(aStart) < Date.parse(bEnd) &&
    Date.parse(bStart) < Date.parse(aEnd)
  );
}

/** Etiqueta legible en la zona del negocio: "mié 5 ago, 10:00". */
export function labelInTz(startUtc: string, tz: string): string {
  const d = new Date(startUtc);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekday = (map.weekday ?? "").replace(/\.$/, "");
  const month = (map.month ?? "").replace(/\.$/, "");
  return `${weekday} ${map.day} ${month}, ${map.hour}:${map.minute}`;
}

/** Solo la hora en la zona del negocio: "10:00". */
export function timeInTz(startUtc: string, tz: string): string {
  const d = new Date(startUtc);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * El día EN PALABRAS, con "hoy"/"mañana" cuando aplica: "hoy viernes 7 de
 * agosto".
 *
 * Existe porque la etiqueta corta no basta: en producción del fork un lead
 * contestó "10:30, de mañana" a una oferta de HOY y se agendó el día
 * equivocado. Quien ofrece tiene que poder decir el día completo.
 */
export function dayLabelInTz(startUtc: string, tz: string, now?: Date): string {
  const d = new Date(startUtc);
  if (Number.isNaN(d.getTime())) return "";
  const dayIso = dayIsoInTz(d, tz);
  const todayIso = dayIsoInTz(now ?? new Date(), tz);

  let prefijo = "";
  if (dayIso === todayIso) prefijo = "hoy ";
  else if (dayIso === addDaysISO(todayIso, 1)) prefijo = "mañana ";

  const cuerpo = new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return `${prefijo}${cuerpo}`;
}

/**
 * Los formateadores de `partsInTz`, uno por zona. Construir un
 * `Intl.DateTimeFormat` cuesta mucho más que usarlo, y el calendario de Citas
 * (215) formatea hasta 3 000 citas por consulta: tres construcciones por cita
 * eran segundos de CPU por respuesta.
 */
const PARTS_FORMATS = new Map<
  string,
  { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat }
>();

function partsFormats(tz: string) {
  let f = PARTS_FORMATS.get(tz);
  if (!f) {
    const mk = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("es-MX", { timeZone: tz, ...opts });
    f = {
      date: mk({ day: "numeric", month: "short", year: "numeric" }),
      time: mk({ hour: "2-digit", minute: "2-digit", hour12: false }),
      weekday: mk({ weekday: "long" }),
    };
    PARTS_FORMATS.set(tz, f);
  }
  return f;
}

/** Partes por separado para la tabla de Citas. */
export function partsInTz(
  startUtc: string,
  tz: string
): { date: string; time: string; weekday: string } {
  const d = new Date(startUtc);
  if (Number.isNaN(d.getTime())) return { date: "", time: "", weekday: "" };
  const f = partsFormats(tz);
  return {
    date: f.date.format(d),
    time: f.time.format(d),
    weekday: f.weekday.format(d),
  };
}
