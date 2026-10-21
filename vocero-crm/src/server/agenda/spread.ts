import {
  addDaysISO,
  dayIsoInTz,
  dayLabelInTz,
  timeInTz,
} from "@/lib/time/slots";
import type { AvailableSlot } from "@/server/agenda/availability";

/**
 * 015 — Reparto de huecos entre días distintos.
 *
 * Los N huecos más próximos casi siempre caen todos HOY, y entonces quien
 * conduce la conversación no tiene nada que ofrecer cuando el lead dice "¿y
 * el jueves?". Esto toma `perDay` por día hasta completar `limit`, de modo que
 * la oferta cubra varios días.
 *
 * El catálogo reservable es MÁS ANCHO que el menú que se muestra: se ofrecen
 * (y se registran) hasta `limit`, aunque el agente enseñe tres. Guardar solo lo
 * enseñado dejaba al agente sin alternativas legítimas que aceptar.
 */

export type SpreadSlot = AvailableSlot & {
  /** Día del slot en la zona del negocio (YYYY-MM-DD). */
  dayIso: string;
  /** El día EN PALABRAS: "hoy miércoles 5 de agosto". */
  dayLabel: string;
  /** Solo la hora: "10:00". */
  time: string;
};

export function spreadByDay(
  slots: AvailableSlot[],
  opts: { timezone: string; limit: number; perDay: number; now?: Date }
): SpreadSlot[] {
  const { timezone, limit, perDay } = opts;
  const now = opts.now ?? new Date();
  if (limit <= 0 || perDay <= 0) return [];

  const byDay = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const dayIso = dayIsoInTz(new Date(slot.startUtc), timezone);
    const bucket = byDay.get(dayIso);
    if (bucket) bucket.push(slot);
    else byDay.set(dayIso, [slot]);
  }

  // Los días ya vienen ordenados porque `slots` viene ordenado; el Map
  // conserva el orden de inserción.
  const out: SpreadSlot[] = [];
  for (const [dayIso, daySlots] of byDay) {
    for (const slot of daySlots.slice(0, perDay)) {
      if (out.length >= limit) return out;
      out.push({
        ...slot,
        dayIso,
        dayLabel: dayLabelInTz(slot.startUtc, timezone, now),
        time: timeInTz(slot.startUtc, timezone),
      });
    }
  }
  return out;
}

/**
 * Qué se consultó de verdad, para que quien ofrece no invente «ese día no hay
 * agenda» ni «solo tengo en la mañana».
 *
 * En la prueba de punta a punta con Nea (sep 2026) un cliente pidió «mañana en
 * la tarde» y el agente le ofreció 10:00, 10:30 y 11:00 diciendo que el martes
 * solo había mañana, con la agenda libre de 12:00 a 18:30. El reparto (tres
 * horas por día) no mentía; lo que faltaba era decir hasta dónde llegaba, y
 * poder preguntar por un día concreto: `date` se ignoraba.
 *
 * Portado de la edición Cloud (002b7bc, `armarHuecos`), sin cerebros ni
 * tenant, con la ventana `days` que solo existe aquí.
 *
 * - `available`: hay huecos (con `date`, los de ese día).
 * - `closed`: ese día el negocio no abre.
 * - `full`: abre, pero no queda nada libre (o ya no da el aviso mínimo).
 * - `past` / `beyond_horizon`: fuera de lo que se puede agendar.
 */
export type EstadoDelDia =
  | "available"
  | "closed"
  | "full"
  | "past"
  | "beyond_horizon";

export type ConsultaDeHuecos = {
  /** El día pedido, o null si es el reparto de siempre. */
  date: string | null;
  /** Solo con `date`. */
  status: EstadoDelDia | null;
  /**
   * Último día REVISADO. Un día posterior que no aparece no se consultó — no
   * es que no tenga agenda. Con `date`, es ese mismo día.
   */
  coveredUntil: string | null;
  /** Último día que se puede agendar (hoy + `maxDaysAhead`). */
  horizonEnd: string;
  /** En el reparto, cuántas horas por día como máximo. null con `date`. */
  perDay: number | null;
};

/** Cuántas horas de UN día se entregan, como mucho, al preguntar por ese día. */
export const HUECOS_POR_FECHA = 24;

/**
 * PURA: si un día trae más huecos que el tope, elige `tope` repartidos a lo
 * largo de TODO el día —el primero y el último incluidos— en vez de los
 * primeros. Cortar por el principio era justo el bug: todo caía en la mañana.
 * Por debajo del tope devuelve la lista tal cual.
 */
export function aLoLargoDelDia<T>(slots: T[], tope: number): T[] {
  if (tope <= 0) return [];
  if (slots.length <= tope) return slots;
  if (tope === 1) return slots.slice(0, 1);
  // paso > 1 porque slots.length > tope: los índices redondeados no se repiten.
  const paso = (slots.length - 1) / (tope - 1);
  return Array.from({ length: tope }, (_, i) => slots[Math.round(i * paso)]!);
}

/**
 * PURA: los huecos a ofrecer y qué tanto cubren.
 *
 * `todos` son los libres del rango consultado (ordenados); `candidatosDelDia`,
 * cuántos turnos tiene ese día en el horario semanal, para distinguir cerrado
 * de lleno. Con `date`, `limit`/`perDay`/`days` no aplican: se devuelve el día
 * completo (hasta `HUECOS_POR_FECHA`, repartidos a lo largo del día). Sin BD
 * ni reloj: tests/unit/agenda-huecos-por-fecha.test.ts.
 */
export function armarHuecos(input: {
  todos: AvailableSlot[];
  timezone: string;
  now: Date;
  maxDaysAhead: number;
  limit: number;
  perDay: number;
  /** Ventana del reparto en días, hoy incluido. Sin ella, todo el horizonte. */
  days?: number;
  date?: string | null;
  candidatosDelDia?: number;
}): { slots: SpreadSlot[]; query: ConsultaDeHuecos } {
  const { timezone, now } = input;
  const hoy = dayIsoInTz(now, timezone);
  const horizonEnd = addDaysISO(hoy, input.maxDaysAhead);
  const diaDe = (s: AvailableSlot) => dayIsoInTz(new Date(s.startUtc), timezone);

  if (input.date) {
    const date = input.date;
    const base = { date, horizonEnd, perDay: null };
    if (date < hoy) {
      return { slots: [], query: { ...base, status: "past", coveredUntil: null } };
    }
    if (date > horizonEnd) {
      return {
        slots: [],
        query: { ...base, status: "beyond_horizon", coveredUntil: null },
      };
    }
    const delDia = aLoLargoDelDia(
      input.todos.filter((s) => diaDe(s) === date),
      HUECOS_POR_FECHA
    );
    const slots = spreadByDay(delDia, {
      timezone,
      limit: HUECOS_POR_FECHA,
      perDay: HUECOS_POR_FECHA,
      now,
    });
    const status: EstadoDelDia =
      slots.length > 0
        ? "available"
        : (input.candidatosDelDia ?? 0) === 0
          ? "closed"
          : "full";
    return { slots, query: { ...base, status, coveredUntil: date } };
  }

  // La ventana se aplica ANTES del reparto: da los mismos huecos que repartir
  // y luego recortar (los días van en orden), y así se sabe qué se revisó.
  const finDeVentana =
    input.days === undefined ? horizonEnd : addDaysISO(hoy, input.days - 1);
  const ventanaHasta = finDeVentana < horizonEnd ? finDeVentana : horizonEnd;
  const slots = spreadByDay(
    input.todos.filter((s) => {
      const dia = diaDe(s);
      return dia >= hoy && dia <= ventanaHasta;
    }),
    { timezone, limit: input.limit, perDay: input.perDay, now }
  );
  // Si el reparto se llenó, lo que viene después del último día incluido no
  // se revisó. Si no se llenó, se recorrió toda la ventana.
  const lleno = slots.length >= input.limit;
  const ultimo = slots[slots.length - 1]?.dayIso;
  return {
    slots,
    query: {
      date: null,
      status: null,
      coveredUntil: lleno && ultimo ? ultimo : ventanaHasta,
      horizonEnd,
      perDay: input.perDay,
    },
  };
}

/** Los días (YYYY-MM-DD) que tienen algo que ofrecer. Los ausentes NO. */
export function daysWithAgenda(slots: SpreadSlot[]): string[] {
  return [...new Set(slots.map((s) => s.dayIso))];
}
