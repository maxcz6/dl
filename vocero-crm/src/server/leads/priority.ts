import type { PriorityValue } from "@/lib/types";

/**
 * Prioridad de cierre del lead.
 *
 * La fija el dueño y NADA la escribe automáticamente. Un CRM que adivina la
 * prioridad y la pisa cuando cambia de opinión es un CRM en el que se deja de
 * confiar: NULL significa "nadie la ha decidido", no "media".
 *
 * Sin sugerencias a propósito. Deducirla exigiría señales que este CRM no tiene
 * (¿está calificado? ¿respondió?), y una sugerencia calculada con dos datos
 * pobres se equivoca lo bastante como para que el dueño deje de mirarla.
 */

export const PRIORITY_VALUES: readonly PriorityValue[] = ["alta", "media", "baja"];

export const PRIORITY_LABELS: Record<PriorityValue, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export function isPriority(v: unknown): v is PriorityValue {
  return typeof v === "string" && (PRIORITY_VALUES as readonly string[]).includes(v);
}

/** Orden de trabajo: alta primero, y lo que no tiene prioridad va al final. */
export const PRIORITY_RANK: Record<PriorityValue, number> = {
  alta: 0,
  media: 1,
  baja: 2,
};

export function priorityRank(value: PriorityValue | null): number {
  return value ? PRIORITY_RANK[value] : 3;
}

/**
 * Ordena por prioridad y, a igualdad, deja el orden que traía. Los leads sin
 * prioridad quedan al final: no son urgentes, pero tampoco se esconden.
 */
export function byPriority<T extends { priority: PriorityValue | null }>(
  leads: readonly T[]
): T[] {
  return [...leads].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}
