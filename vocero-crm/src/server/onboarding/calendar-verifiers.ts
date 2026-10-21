import { isConnectorId } from "@/lib/agenda-connectors";

/**
 * ¿La agenda está lista para que el agente agende por el negocio?
 *
 * Se decide con lo PERSISTIDO: horarios y conector guardados en Ajustes →
 * Agenda y el estado de la credencial del conector. Que la reunión de verdad
 * se entregue lo demuestra la prueba de conexión de cada conector, no esto.
 *
 * Pura (sin base de datos) para poder probar la tabla de decisión sola.
 * Puerto de `calendar-verifiers.ts` de Vocero Cloud, recortado al catálogo de
 * la raíz: `enlace-fijo`, `zoom` y `google` (que aquí hace calendario y Meet
 * en una sola credencial).
 */
export type CalendarConfiguration = {
  connector: string;
  /** `{"mon":[{"start":"09:00","end":"18:00"}]}`; `unknown` porque viene de jsonb. */
  weeklyHours: unknown;
};

export type CalendarReadiness = "ready" | "pending" | "unsupported";

/** Qué conectores tienen credencial guardada y aceptada. */
export type CalendarConnections = { google: boolean; zoom: boolean };

const HORA = /^\d{2}:\d{2}$/;

/** ¿Hay al menos un día con un intervalo bien formado y no vacío? */
export function hasWeeklyHours(weeklyHours: unknown): boolean {
  if (!weeklyHours || typeof weeklyHours !== "object") return false;
  return Object.values(weeklyHours as Record<string, unknown>).some(
    (day) =>
      Array.isArray(day) &&
      day.some((slot: unknown) => {
        if (!slot || typeof slot !== "object") return false;
        const { start, end } = slot as { start?: unknown; end?: unknown };
        return (
          typeof start === "string" &&
          typeof end === "string" &&
          HORA.test(start) &&
          HORA.test(end) &&
          start < end
        );
      })
  );
}

export function verifyCalendar(
  configuration: CalendarConfiguration | undefined,
  connections: CalendarConnections = { google: false, zoom: false }
): CalendarReadiness {
  // Sin fila, nadie guardó nada todavía: la agenda arranca con horarios de
  // fábrica utilizables, pero la guía pide que el dueño los confirme.
  if (!configuration) return "pending";
  if (!hasWeeklyHours(configuration.weeklyHours)) return "pending";
  // Un conector que ya no existe en el código (venías de un fork): el motor
  // lo degrada al soberano al leer, pero aquí se dice, para que lo arreglen.
  if (!isConnectorId(configuration.connector)) return "unsupported";
  if (configuration.connector === "google" && !connections.google) return "pending";
  if (configuration.connector === "zoom" && !connections.zoom) return "pending";
  return "ready";
}
