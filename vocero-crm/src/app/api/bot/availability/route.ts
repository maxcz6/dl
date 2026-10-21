import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { scoped } from "@/lib/db/tenant";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { addDaysISO, todayInTz } from "@/lib/time/slots";
import {
  buildCandidateSlots,
  computeAvailability,
} from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import { armarHuecos, daysWithAgenda } from "@/server/agenda/spread";
import { replaceOffers } from "@/server/agenda/offers";

export const dynamic = "force-dynamic";

/**
 * 015 — Los horarios que se le van a ofrecer al cliente, para quien conduce la
 * conversación.
 *
 * A diferencia de la vista del operador, esta REGISTRA la oferta: es ese
 * registro lo que después habilita la reserva. Sin él, `POST /api/bot/bookings`
 * rechaza cualquier instante.
 *
 * El catálogo reservable (`limit`) es más ancho que el menú que el agente
 * enseña: guardar solo los tres que se muestran deja al agente sin nada
 * legítimo que aceptar cuando el cliente pide otro día.
 *
 * Sin `date` es un REPARTO (hasta `perDay` horas de cada día) y `query` dice
 * hasta dónde llega. Con `date=YYYY-MM-DD` (día en la zona del negocio)
 * devuelve las horas libres de ESE día, repartidas a lo largo del día, y
 * `query.status` dice por qué no hay ninguna. Sin esto, a «¿mañana en la
 * tarde?» el cerebro solo veía las tres primeras horas de mañana y contestaba
 * que solo había mañana (`src/server/agenda/spread.ts`, `armarHuecos`).
 */

const LIMITS = {
  limit: { min: 1, max: 48, def: 12 },
  perDay: { min: 1, max: 8, def: 3 },
  days: { min: 1, max: 14, def: 5 },
};

function clamp(raw: string | null, l: { min: number; max: number; def: number }) {
  // Ausente o vacío ⇒ el default del contrato. `Number(null)` es 0, no NaN:
  // sin este corte, pedir sin parámetros daba UN hueco de UN día.
  if (raw === null || raw.trim() === "") return l.def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return l.def;
  return Math.max(l.min, Math.min(l.max, Math.round(n)));
}

export async function GET(req: Request) {
  // La bandera se evalúa ANTES que la llave: si esta instancia no tiene
  // agenda, el endpoint no existe — no hay nada que autenticar.
  if (!agendaEnabled()) return agendaDisabledResponse();

  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return apiError(422, "invalid_body", "Falta conversationId");
  }
  // `date` es opcional; vacío cuenta como ausente. Mal formada o inexistente
  // en el calendario (2026-02-31) → 422, nunca un 500 ni el reparto callado.
  const date = url.searchParams.get("date")?.trim() || null;
  if (date !== null && !fechaValida(date)) {
    return apiError(
      422,
      "invalid_body",
      "date debe ser una fecha real en formato YYYY-MM-DD"
    );
  }

  const db = getDb();
  const rows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  if (!rows[0]) return apiError(404, "not_found", "Conversación no encontrada");

  const limit = clamp(url.searchParams.get("limit"), LIMITS.limit);
  const perDay = clamp(url.searchParams.get("perDay"), LIMITS.perDay);
  const days = clamp(url.searchParams.get("days"), LIMITS.days);

  const settings = await getSettings(organizationId);
  const now = new Date();
  const hoy = todayInTz(now, settings.timezone);
  // Un día fuera de lo agendable ni se calcula: no hay nada que buscar.
  const dentro =
    !date || (date >= hoy && date <= addDaysISO(hoy, settings.maxDaysAhead));
  const todos = dentro
    ? await computeAvailability(organizationId, {
        settings,
        now,
        ...(date ? { fromISO: date, toISO: date } : {}),
      })
    : [];
  const { slots, query } = armarHuecos({
    todos,
    timezone: settings.timezone,
    now,
    maxDaysAhead: settings.maxDaysAhead,
    limit,
    perDay,
    days,
    date,
    candidatosDelDia:
      date && dentro ? buildCandidateSlots(settings, date, date).length : 0,
  });

  // Reemplazo completo: la oferta vigente es siempre la última. Pero una
  // consulta por día que no encontró nada NO borra lo ya ofrecido: el cliente
  // que pregunta por el sábado y oye «ese día no abrimos» todavía puede
  // quedarse con el viernes que se le dio antes.
  if (!date || slots.length > 0) {
    await replaceOffers(
      organizationId,
      conversationId,
      slots.map((s) => ({ startUtc: s.startUtc, label: s.label }))
    );
  }

  return Response.json({
    slots: slots.map((s) => ({
      startUtc: s.startUtc,
      endUtc: s.endUtc,
      label: s.label,
      dayIso: s.dayIso,
      dayLabel: s.dayLabel,
      time: s.time,
    })),
    // Los días que NO están aquí no tienen agenda HASTA `query.coveredUntil`:
    // lo posterior no se revisó, y de cada día se ven hasta `query.perDay`
    // horas. Para un día concreto, se pregunta con `date`.
    diasConAgenda: daysWithAgenda(slots),
    query,
  });
}

/** YYYY-MM-DD que además existe en el calendario (nada de 2026-02-31). */
function fechaValida(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
