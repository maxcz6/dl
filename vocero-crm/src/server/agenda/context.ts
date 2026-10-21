import { eq, gte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { dayLabelInTz, timeInTz } from "@/lib/time/slots";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";

/**
 * 015 — Las citas del contacto, para el contexto de un cerebro externo
 * (`GET /api/bot/context` → `booking`).
 *
 * Existe porque, sin esto, un cerebro solo sabe de una cita por lo que
 * recuerda de la conversación. En la edición cloud, donde se vio primero, eso
 * dio tres fallos con el mismo origen: reservó una cita NUEVA para quien no
 * llegó a la suya (la vieja siguió «agendada»), le repitió a un cliente a las
 * cinco de la tarde que su demo era «hoy a las 10:30», y ante «pásame la liga»
 * escaló a un humano en vez de mandar el enlace que el CRM tenía guardado.
 * Nea ya sabe leer este bloque (`_booking_lines` en su `prompt.py`); lo que
 * faltaba era que la raíz lo mandara.
 *
 * La FORMA es la de la edición cloud, para que un mismo cerebro sirva contra
 * las dos (más `status` en las vigentes, que es aditivo). Tres citas, porque
 * piden respuestas distintas:
 * - `next`: la próxima «agendada». Es la que `PATCH /api/bot/bookings` mueve.
 * - `unresolved`: la última que YA empezó (hasta 7 días atrás) y nadie cerró.
 *   El cliente que escribe «no pude entrar» habla de ésta; darla por vigente
 *   es justo el error que hay que evitar. Con `endUtc` se sabe si sigue en
 *   curso.
 * - `lastClosed`: la última que se CERRÓ hace poco (cancelada, no asistió o
 *   realizada). Sin ella, a quien le cancelaron la cita desde el panel el
 *   agente le contestó «no quedó guardada, por alguna razón»: veía la cita en
 *   el historial, no en el contexto, e inventó el motivo.
 *
 * Una cita de PRUEBA (`is_test`, del Laboratorio) jamás aparece aquí: es de
 * un cliente simulado, y presentarla como real le haría negar o proteger una
 * cita que no existe. Los bloqueos del operador tampoco: no son de nadie.
 */

/** Hasta cuándo atrás una cita sin cerrar sigue siendo tema de conversación. */
export const DIAS_SIN_CERRAR = 7;

/** Hasta cuándo atrás una cita cerrada sigue siendo tema de conversación. */
export const DIAS_CERRADA = 7;

const DIA_MS = 86_400_000;

export type CitaEnContexto = {
  id: string;
  /** Siempre `agendada`: las cerradas van en `lastClosed`. */
  status: "agendada";
  startUtc: string;
  endUtc: string;
  /** El día en palabras y la hora, en la zona del negocio: "hoy lunes, 14 de septiembre, 10:30". */
  label: string;
  meetingLink: string | null;
  /** true ⇒ la cita existe pero el proveedor aún no entregó el enlace. */
  linkPending: boolean;
};

export type EstadoCerrada = "cancelada" | "no_show" | "realizada";

export type CitaCerrada = {
  id: string;
  status: EstadoCerrada;
  startUtc: string;
  endUtc: string;
  label: string;
  /** Cuándo se cerró (la última escritura de la cita). */
  closedAt: string;
  /**
   * Solo en `cancelada`. En la raíz siempre es `equipo`: cancelar no existe
   * por `/api/bot/*` (esa decisión es del dueño y el camino es el handoff) ni
   * para el agente in-process, así que solo se cancela desde el panel. El
   * campo va igual para que la forma sea la de la edición cloud, donde el
   * cerebro sí puede cancelar y aparece `agente`.
   */
  cancelledBy: "equipo" | null;
  // Sin enlace a propósito: el de una cita cerrada ya no sirve.
};

export type CitasEnContexto = {
  /** Zona del negocio, en la que están las etiquetas. */
  timezone: string;
  next: CitaEnContexto | null;
  unresolved: CitaEnContexto | null;
  lastClosed: CitaCerrada | null;
};

/** La cita tal cual sale de la base, antes de elegir y dar forma. */
export type FilaCita = {
  id: string;
  kind: "session" | "block";
  status: "agendada" | EstadoCerrada;
  isTest: boolean;
  scheduledAt: Date;
  durationMinutes: number;
  meetingLink: string | null;
  linkPending: boolean;
  updatedAt: Date;
};

function forma(fila: FilaCita, timezone: string, now: Date) {
  const startUtc = fila.scheduledAt.toISOString();
  return {
    id: fila.id,
    startUtc,
    endUtc: new Date(
      fila.scheduledAt.getTime() + fila.durationMinutes * 60_000
    ).toISOString(),
    label: `${dayLabelInTz(startUtc, timezone, now)}, ${timeInTz(startUtc, timezone)}`,
  };
}

function vigente(fila: FilaCita, timezone: string, now: Date): CitaEnContexto {
  return {
    ...forma(fila, timezone, now),
    status: "agendada",
    meetingLink: fila.meetingLink,
    linkPending: fila.linkPending,
  };
}

function cerrada(fila: FilaCita, timezone: string, now: Date): CitaCerrada {
  const status = fila.status as EstadoCerrada;
  return {
    ...forma(fila, timezone, now),
    status,
    closedAt: fila.updatedAt.toISOString(),
    cancelledBy: status === "cancelada" ? "equipo" : null,
  };
}

/**
 * PURA: de las citas del contacto, elige las tres que importan y les da forma.
 *
 * El filtro de prueba y de bloqueos vive AQUÍ, no solo en la consulta: es la
 * garantía, y así la fija una prueba sin base de datos.
 */
export function citasEnContexto(
  filas: FilaCita[],
  timezone: string,
  now: Date
): CitasEnContexto {
  const reales = filas.filter((f) => !f.isTest && f.kind === "session");
  const agendadas = reales.filter((f) => f.status === "agendada");
  const t = now.getTime();

  const next = agendadas
    .filter((f) => f.scheduledAt.getTime() >= t)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

  const unresolved = agendadas
    .filter((f) => {
      const inicio = f.scheduledAt.getTime();
      return inicio < t && inicio >= t - DIAS_SIN_CERRAR * DIA_MS;
    })
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0];

  const lastClosed = reales
    .filter(
      (f) =>
        f.status !== "agendada" && f.updatedAt.getTime() >= t - DIAS_CERRADA * DIA_MS
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  return {
    timezone,
    next: next ? vigente(next, timezone, now) : null,
    unresolved: unresolved ? vigente(unresolved, timezone, now) : null,
    lastClosed: lastClosed ? cerrada(lastClosed, timezone, now) : null,
  };
}

/**
 * El bloque `booking` del contexto, o `null` cuando no debe ir.
 *
 * `null` con la agenda apagada: en esa instancia no hay citas de las que
 * hablar, y un bloque vacío haría creer al cerebro que las consultó y que el
 * lead no tiene ninguna. Ni siquiera se toca la base.
 *
 * `null` también si la lectura falla. La agenda es un módulo opcional y el
 * contexto es lo que deja al cerebro contestar: sin contexto se calla, y
 * callar al cliente por no poder consultar la agenda sería peor que no
 * mencionarla. Sin bloque, el cerebro no afirma nada sobre citas.
 */
export async function citasParaContexto(
  organizationId: string,
  contactId: string,
  now = new Date()
): Promise<CitasEnContexto | null> {
  if (!agendaEnabled()) return null;
  try {
    return await leerCitas(organizationId, contactId, now);
  } catch (err) {
    console.error(
      `[agenda] no pude leer las citas del contacto ${contactId} para el contexto:`,
      err
    );
    return null;
  }
}

async function leerCitas(
  organizationId: string,
  contactId: string,
  now: Date
): Promise<CitasEnContexto> {
  const db = getDb();
  const desdeSinCerrar = new Date(now.getTime() - DIAS_SIN_CERRAR * DIA_MS);
  const desdeCerrada = new Date(now.getTime() - DIAS_CERRADA * DIA_MS);

  const [settings, filas] = await Promise.all([
    getSettings(organizationId),
    db
      .select({
        id: schema.booking.id,
        kind: schema.booking.kind,
        status: schema.booking.status,
        isTest: schema.booking.isTest,
        scheduledAt: schema.booking.scheduledAt,
        durationMinutes: schema.booking.durationMinutes,
        meetingLink: schema.booking.meetingLink,
        linkPending: schema.booking.linkPending,
        updatedAt: schema.booking.updatedAt,
      })
      .from(schema.booking)
      .where(
        scoped(
          schema.booking.organizationId,
          organizationId,
          eq(schema.booking.contactId, contactId),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.isTest, false),
          // Lo único que puede salir: lo que viene o empezó hace poco, y lo
          // que se cerró hace poco. Acota la lectura a un puñado de filas.
          or(
            gte(schema.booking.scheduledAt, desdeSinCerrar),
            gte(schema.booking.updatedAt, desdeCerrada)
          )
        )
      ),
  ]);

  return citasEnContexto(filas, settings.timezone, now);
}
