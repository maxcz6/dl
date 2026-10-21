import { graphRequest, MetaApiError } from "@/lib/meta/client";
import type { MessengerCredentials } from "@/server/messenger/credentials";
import { sendZernioMessage } from "@/server/zernio";

/**
 * 017 — Frontera de salida del canal de Messenger (Constitución II: todo
 * request a una plataforma pasa por un único módulo).
 *
 * Dos transportes, misma firma: Zernio (API unificada) y Meta directo. El de
 * Meta habla por `graph.facebook.com`, el MISMO host que WhatsApp, así que
 * reutiliza el cliente de Graph que ya existe (`graphRequest`): misma versión
 * de API, mismo `META_GRAPH_BASE_URL` (y por tanto el mismo mock en pruebas) y
 * los mismos errores tipados que el resto del CRM ya interpreta.
 */

export type MessengerSendResult = { platformMessageId: string };

/**
 * Cuerpo del envío por Meta. Separado para poder afirmarlo en una prueba sin
 * red: la etiqueta de agente humano es lo único que distingue un envío dentro
 * de la ventana de uno fuera, y equivocarla no da error de compilación — da un
 * 400 de Meta en producción a las 2 de la mañana.
 */
export function buildMessengerSendBody(input: {
  recipient: string;
  text: string;
  humanAgentTag: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    recipient: { id: input.recipient },
    message: { text: input.text },
    // RESPONSE dentro de la ventana estándar de 24 h. Fuera, Messenger no
    // tiene plantillas: la única vía es la etiqueta HUMAN_AGENT (7 días).
    messaging_type: input.humanAgentTag ? "MESSAGE_TAG" : "RESPONSE",
  };
  if (input.humanAgentTag) body.tag = "HUMAN_AGENT";
  return body;
}

/**
 * Envía texto por el transporte que corresponda.
 *
 * `recipient` es el PSID (sin el prefijo `fb:`); `threadRef` es el
 * conversationId opaco de Zernio, que solo hace falta en ese transporte.
 */
export async function sendMessengerText(input: {
  credentials: MessengerCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  humanAgentTag?: boolean;
  /** Id del mensaje en Vocero: llave natural de idempotencia en Zernio. */
  idempotencyKey?: string;
}): Promise<MessengerSendResult> {
  if (input.credentials.source === "zernio") {
    return sendZernioMessage({
      token: input.credentials.token,
      accountId: input.credentials.accountRef,
      conversationId: input.threadRef,
      text: input.text,
      humanAgentTag: input.humanAgentTag,
      idempotencyKey: input.idempotencyKey,
    });
  }
  return sendViaMeta(input);
}

/**
 * Meta responde `{ recipient_id, message_id }`; el mock de Graph del entorno
 * de pruebas responde con la forma de WhatsApp (`messages[0].id`), y se
 * aceptan las dos para que el mismo código sirva en ambos.
 */
async function sendViaMeta(input: {
  credentials: MessengerCredentials;
  recipient: string;
  text: string;
  humanAgentTag?: boolean;
}): Promise<MessengerSendResult> {
  const { pageId } = input.credentials;
  if (!pageId) {
    throw new MetaApiError(
      "La conexión de Messenger no tiene ID de página para enviar",
      { status: 400 }
    );
  }
  const res = await graphRequest<{
    message_id?: string;
    messages?: { id: string }[];
  }>(`${pageId}/messages`, {
    method: "POST",
    token: input.credentials.token,
    body: buildMessengerSendBody({
      recipient: input.recipient,
      text: input.text,
      humanAgentTag: input.humanAgentTag ?? false,
    }),
  });
  const id = res.message_id ?? res.messages?.[0]?.id;
  if (!id) {
    throw new MetaApiError("Meta no devolvió ID de mensaje", { status: 502 });
  }
  return { platformMessageId: String(id) };
}

/**
 * Nombre visible de quien escribe. El webhook de Messenger de Meta no trae
 * nombre —solo el PSID—, y un contacto llamado "8371…" en la bandeja es
 * inservible para el operador. Se consulta al perfil con el token de la
 * página; si Meta no lo da (permiso ausente, perfil restringido) se devuelve
 * null y la ingesta cae al nombre de respaldo: nunca se bloquea un mensaje por
 * un nombre. En modo Zernio no hace falta — el evento ya trae el nombre.
 */
export async function fetchMessengerProfileName(
  credentials: MessengerCredentials,
  psid: string
): Promise<string | null> {
  if (credentials.source !== "meta") return null;
  try {
    const res = await graphRequest<{
      first_name?: string;
      last_name?: string;
      name?: string;
    }>(`${psid}?fields=first_name,last_name`, { token: credentials.token });
    const full = [res.first_name, res.last_name]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" ")
      .trim();
    return full || res.name?.trim() || null;
  } catch {
    return null;
  }
}
