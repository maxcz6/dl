import { createHash } from "node:crypto";
import { getEnv } from "@/lib/env";
import {
  ConnectorError,
  type AgendaConnector,
  type MeetingRequest,
  type MeetingResult,
  type TestConnectionResult,
} from "@/server/agenda/connectors/types";
import {
  getCachedGoogleToken,
  setCachedGoogleToken,
  type GoogleCreds,
} from "@/server/agenda/connectors/google-credentials";

/**
 * 015 — Conector Google Calendar + Meet, por REST directo (sin SDK: la
 * constitución no admite dependencias nuevas para esto).
 *
 * Cada cita se convierte en un evento del calendario del dueño con su enlace
 * de Meet. Es el conector con un diferencial claro: la cita aparece donde el
 * dueño ya mira su día.
 *
 * DOS cosas de Google que dan problemas y aquí están resueltas a propósito:
 *
 *  1. **La conferencia se crea de forma ASÍNCRONA.** La respuesta inmediata de
 *     `events.insert` puede traer `conferenceData.createRequest.status =
 *     "pending"` y ningún enlace. Por eso se re-lee el evento unas pocas veces
 *     antes de rendirse; y si aun así no llegó, la cita se entrega con el
 *     evento creado y el enlace pendiente (reintentable), nunca duplicando.
 *  2. **El refresh token caduca a los 7 días si la app OAuth está en modo
 *     prueba.** Eso no se puede arreglar desde aquí: se advierte en la guía de
 *     conexión, y cuando pasa, el 401 marca la credencial como rota para que
 *     el dueño se entere por la UI y no por un cliente sin enlace.
 */

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** Cuántas veces se re-lee el evento esperando el enlace de Meet. */
const CONFERENCE_POLLS = 3;
const POLL_DELAY_MS = 400;

/**
 * La clave del caché incluye TODO lo que determina el token.
 *
 * Era `clientId:calendarId`. Como el refresh token y el secreto no entraban,
 * cambiar credenciales no tenía efecto observable hasta que el token expiraba
 * —una hora— y el operador concluía que las nuevas también estaban mal. Pasó
 * de verdad: tras corregir el scope y regenerar el refresh token, la prueba
 * seguía devolviendo el MISMO 403, palabra por palabra (#50, punto 3).
 *
 * Va como hash y no en claro porque esta clave vive en memoria del proceso y
 * no hay motivo para tener un refresh token dando vueltas en ella.
 */
function claveDeToken(creds: GoogleCreds): string {
  // `JSON.stringify` del array y no un separador a mano: los valores son
  // opacos y una concatenación cruda podría colisionar entre credenciales
  // distintas. Aquí la ambigüedad la resuelve el propio formato.
  return createHash("sha256")
    .update(
      JSON.stringify([
        creds.clientId,
        creds.clientSecret,
        creds.refreshToken,
        creds.calendarId,
      ])
    )
    .digest("hex");
}

async function getAccessToken(creds: GoogleCreds): Promise<string> {
  const key = claveDeToken(creds);
  const cached = getCachedGoogleToken(key);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(`${getEnv().GOOGLE_OAUTH_BASE_URL}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (err) {
    throw new ConnectorError("google", `No se pudo contactar a Google: ${err}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConnectorError(
      "google",
      `Google rechazó el refresh token: ${detail}. Si tu app OAuth sigue en modo prueba, Google lo revoca a los 7 días: publícala en producción y vuelve a conectar.`,
      // `invalid_grant` llega como 400 y significa exactamente eso: hay que
      // reconectar.
      { status: res.status, isAuthError: res.status === 401 || res.status === 400 }
    );
  }

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!data?.access_token) {
    throw new ConnectorError("google", "Google no devolvió un token de acceso");
  }
  setCachedGoogleToken(key, data.access_token, data.expires_in ?? 3600);
  return data.access_token;
}

async function googleFetch(
  creds: GoogleCreds,
  path: string,
  init: RequestInit & { allow404?: boolean } = {}
): Promise<unknown> {
  const token = await getAccessToken(creds);
  let res: Response;
  try {
    res = await fetch(`${getEnv().GOOGLE_CAL_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ConnectorError("google", `No se pudo contactar a Google: ${err}`);
  }

  if (res.status === 404 && init.allow404) return null;
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConnectorError(
      "google",
      `Google respondió ${res.status}: ${detail}`,
      { status: res.status }
    );
  }
  return await res.json().catch(() => null);
}

type GoogleEvent = {
  id?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

/** El enlace de la videollamada, mire donde mire Google. */
function meetLinkOf(event: GoogleEvent | null): string | null {
  if (!event) return null;
  const video = event.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video"
  );
  return video?.uri ?? event.hangoutLink ?? null;
}

function eventsPath(creds: GoogleCreds, suffix = ""): string {
  return `/calendars/${encodeURIComponent(creds.calendarId)}/events${suffix}`;
}

export const googleConnector: AgendaConnector<GoogleCreds> = {
  id: "google",
  requiresCredentials: true,

  async createMeeting(creds, req: MeetingRequest): Promise<MeetingResult> {
    const endUtc = new Date(
      Date.parse(req.startUtc) + req.durationMinutes * 60_000
    ).toISOString();

    const created = (await googleFetch(
      creds,
      `${eventsPath(creds)}?conferenceDataVersion=1`,
      {
        method: "POST",
        body: JSON.stringify({
          summary: req.topic,
          description: req.notes ?? undefined,
          start: { dateTime: req.startUtc, timeZone: "UTC" },
          end: { dateTime: endUtc, timeZone: "UTC" },
          conferenceData: {
            createRequest: {
              // Google exige un id de petición propio; el instante lo hace
              // único por cita sin necesitar aleatoriedad.
              requestId: `vocero-${Date.parse(req.startUtc)}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      }
    )) as GoogleEvent | null;

    const eventId = created?.id ?? null;
    if (!eventId) {
      throw new ConnectorError("google", "Google no devolvió el evento creado");
    }

    let link = meetLinkOf(created);
    // La conferencia se genera en segundo plano: la respuesta del insert suele
    // venir `pending`. Se re-lee un par de veces antes de rendirse.
    for (let i = 0; i < CONFERENCE_POLLS && !link; i++) {
      await sleep(POLL_DELAY_MS);
      const refreshed = (await googleFetch(
        creds,
        `${eventsPath(creds, `/${encodeURIComponent(eventId)}`)}`
      ).catch(() => null)) as GoogleEvent | null;
      link = meetLinkOf(refreshed);
    }

    // Con el evento creado y sin enlace, el motor deja la cita "sin enlace" y
    // el operador reintenta: eso re-lee este mismo evento, no crea otro.
    return { externalId: eventId, joinUrl: link };
  },

  async refreshMeeting(creds, externalId): Promise<MeetingResult> {
    const event = (await googleFetch(
      creds,
      eventsPath(creds, `/${encodeURIComponent(externalId)}`)
    )) as GoogleEvent | null;
    return { externalId, joinUrl: meetLinkOf(event) };
  },

  async updateMeeting(creds, externalId, req): Promise<void> {
    const endUtc = new Date(
      Date.parse(req.startUtc) + req.durationMinutes * 60_000
    ).toISOString();
    await googleFetch(creds, eventsPath(creds, `/${encodeURIComponent(externalId)}`), {
      method: "PATCH",
      body: JSON.stringify({
        start: { dateTime: req.startUtc, timeZone: "UTC" },
        end: { dateTime: endUtc, timeZone: "UTC" },
      }),
    });
  },

  async deleteMeeting(creds, externalId): Promise<void> {
    await googleFetch(creds, eventsPath(creds, `/${encodeURIComponent(externalId)}`), {
      method: "DELETE",
      allow404: true,
    });
  },

  async testConnection(creds): Promise<TestConnectionResult> {
    try {
      /**
       * Se listan eventos, no se lee el calendario.
       *
       * `GET /calendars/{id}` es `Calendars.Get`, y Google solo lo concede con
       * `calendar.readonly` o superior. Con el scope que este conector pide de
       * verdad —`calendar.events`, suficiente para insert/get/patch/delete— la
       * llamada devuelve 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT: la conexión
       * funcionaba y su PROPIA prueba fallaba (#50, punto 2).
       *
       * Listar un evento sí entra en `calendar.events`, así que el scope
       * documentado sigue siendo el mínimo — que es la razón de pedirlo.
       */
      const lista = (await googleFetch(
        creds,
        eventsPath(creds, "?maxResults=1")
      )) as { summary?: string } | null;
      // `summary` del listado es el nombre del calendario: el mismo dato que
      // se enseñaba antes, por una vía que el scope permite.
      return { ok: true, detail: lista?.summary };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "No se pudo conectar con Google",
      };
    }
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
