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
  getCachedZoomToken,
  setCachedZoomToken,
  type ZoomCreds,
} from "@/server/agenda/connectors/zoom-credentials";

/**
 * 015 — Conector Zoom (Server-to-Server OAuth).
 *
 * Es el conector de referencia: su forma exacta lleva meses en producción en un
 * CRM real, y el contrato de conectores se midió de este uso.
 *
 * Frontera única de salida hacia Zoom: fuera de este archivo, nadie sabe que
 * Zoom existe.
 */

/**
 * Los CUATRO scopes granulares que hacen falta. `user:read:user` es el que se
 * olvida —lo usa la prueba de conexión— y sin él conectar falla aunque las
 * credenciales sirvan para crear reuniones.
 */
export const ZOOM_SCOPES = [
  "meeting:write:meeting",
  "meeting:update:meeting",
  "meeting:delete:meeting",
  "user:read:user",
] as const;

/**
 * La clave del caché incluye TODO lo que determina el token.
 *
 * Misma trampa que la de Google (#50, punto 3), que aquí nadie ha reportado
 * todavía porque el conector se usa menos: era `accountId:clientId`, así que
 * cambiar el SECRETO no tenía efecto observable hasta que el token expiraba y
 * el operador concluía que las credenciales nuevas también estaban mal.
 *
 * Se arregla junto con la otra a propósito: dejar una de las dos copias de un
 * mismo error es cómo vuelve.
 */
function claveDeToken(creds: ZoomCreds): string {
  return createHash("sha256")
    .update(JSON.stringify([creds.accountId, creds.clientId, creds.clientSecret]))
    .digest("hex");
}

async function getAccessToken(creds: ZoomCreds): Promise<string> {
  const key = claveDeToken(creds);
  const cached = getCachedZoomToken(key);
  if (cached) return cached;

  const base = getEnv().ZOOM_OAUTH_BASE_URL;
  const url = `${base}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
    creds.accountId
  )}`;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
    "base64"
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    });
  } catch (err) {
    throw new ConnectorError("zoom", `No se pudo contactar a Zoom: ${err}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConnectorError("zoom", `Zoom rechazó las credenciales: ${detail}`, {
      status: res.status,
      // El endpoint de token responde 400 cuando las credenciales no sirven:
      // aquí un 400 SÍ es un problema de autenticación, a diferencia del resto
      // de la API, donde suele ser una validación del cuerpo.
      isAuthError: res.status === 401 || res.status === 400,
    });
  }

  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!data?.access_token) {
    throw new ConnectorError("zoom", "Zoom no devolvió un token de acceso");
  }
  setCachedZoomToken(key, data.access_token, data.expires_in ?? 3600);
  return data.access_token;
}

async function zoomFetch(
  creds: ZoomCreds,
  path: string,
  init: RequestInit & { allow404?: boolean } = {}
): Promise<unknown> {
  const token = await getAccessToken(creds);
  const url = `${getEnv().ZOOM_BASE_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ConnectorError("zoom", `No se pudo contactar a Zoom: ${err}`);
  }

  // Idempotencia: borrar algo que ya no está es objetivo cumplido.
  if (res.status === 404 && init.allow404) return null;
  if (res.status === 204) return null;

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConnectorError("zoom", `Zoom respondió ${res.status}: ${detail}`, {
      status: res.status,
    });
  }
  return await res.json().catch(() => null);
}

export const zoomConnector: AgendaConnector<ZoomCreds> = {
  id: "zoom",
  requiresCredentials: true,

  async createMeeting(creds, req: MeetingRequest): Promise<MeetingResult> {
    const data = (await zoomFetch(creds, "/users/me/meetings", {
      method: "POST",
      body: JSON.stringify({
        topic: req.topic,
        type: 2, // reunión programada
        // Zoom rechaza los milisegundos en start_time.
        start_time: req.startUtc.replace(/\.\d{3}Z$/, "Z"),
        duration: req.durationMinutes,
        timezone: req.timezone,
        agenda: req.notes ?? undefined,
        settings: { join_before_host: true, waiting_room: false },
      }),
    })) as { id?: number | string; join_url?: string } | null;

    if (!data?.id || !data.join_url) {
      throw new ConnectorError("zoom", "Zoom no devolvió la reunión creada");
    }
    return { externalId: String(data.id), joinUrl: data.join_url };
  },

  async updateMeeting(creds, externalId, req): Promise<void> {
    // Solo la hora: el mismo id conserva el mismo join_url, que es lo que el
    // cliente ya tiene guardado.
    await zoomFetch(creds, `/meetings/${encodeURIComponent(externalId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        start_time: req.startUtc.replace(/\.\d{3}Z$/, "Z"),
        duration: req.durationMinutes,
        timezone: req.timezone,
      }),
    });
  },

  async deleteMeeting(creds, externalId): Promise<void> {
    await zoomFetch(creds, `/meetings/${encodeURIComponent(externalId)}`, {
      method: "DELETE",
      allow404: true,
    });
  },

  async testConnection(creds): Promise<TestConnectionResult> {
    try {
      const me = (await zoomFetch(creds, "/users/me")) as {
        email?: string;
      } | null;
      return { ok: true, detail: me?.email };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "No se pudo conectar con Zoom",
      };
    }
  },
};
