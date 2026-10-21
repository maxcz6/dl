import { MetaApiError } from "@/lib/meta/client";
import type { InstagramCredentials } from "@/server/instagram/credentials";

/**
 * 014 — Frontera de salida del canal de Instagram (Constitución II: todo
 * request a una plataforma pasa por un único módulo).
 *
 * Dos transportes, misma firma: Zernio (API unificada) y Meta directo
 * (graph.instagram.com). Ambos devuelven el id del mensaje en la plataforma.
 */

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1";
const IG_GRAPH_BASE =
  process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com";
const IG_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? "v25.0";

/** Instagram corta el texto en 1000 BYTES (no caracteres): con acentos y
 * emojis el margen real es menor de lo que aparenta. */
export const IG_TEXT_MAX_BYTES = 1000;

export function fitsInstagramText(text: string): boolean {
  return Buffer.byteLength(text, "utf8") <= IG_TEXT_MAX_BYTES;
}

export type InstagramSendResult = { platformMessageId: string };

/**
 * Envía texto por el transporte que corresponda.
 *
 * `recipient` es el IGSID (sin el prefijo `ig:`); `threadRef` es el
 * conversationId opaco de Zernio, que solo hace falta en ese transporte.
 */
export async function sendInstagramText(input: {
  credentials: InstagramCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  /** Fuera de la ventana de 24 h Instagram solo admite HUMAN_AGENT. */
  humanAgentTag?: boolean;
}): Promise<InstagramSendResult> {
  return input.credentials.source === "zernio"
    ? sendViaZernio(input)
    : sendViaMeta(input);
}

async function sendViaZernio(input: {
  credentials: InstagramCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  humanAgentTag?: boolean;
}): Promise<InstagramSendResult> {
  const { credentials, threadRef } = input;
  if (!threadRef) {
    throw new MetaApiError(
      "La conversacion no tiene referencia de hilo en Zernio",
      { status: 400 }
    );
  }
  const body: Record<string, unknown> = {
    accountId: credentials.accountRef,
    message: input.text,
  };
  if (input.humanAgentTag) {
    body.messagingType = "MESSAGE_TAG";
    body.messageTag = "HUMAN_AGENT";
  }

  const res = await fetchJson(
    `${ZERNIO_BASE}/inbox/conversations/${encodeURIComponent(threadRef)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const id =
    (res as { message?: { id?: string }; id?: string }).message?.id ??
    (res as { id?: string }).id ??
    `zernio_${Date.now()}`;
  return { platformMessageId: String(id) };
}

async function sendViaMeta(input: {
  credentials: InstagramCredentials;
  recipient: string;
  text: string;
  humanAgentTag?: boolean;
}): Promise<InstagramSendResult> {
  const { credentials } = input;
  const body: Record<string, unknown> = {
    recipient: { id: input.recipient },
    message: { text: input.text },
  };
  if (input.humanAgentTag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }

  // El host es graph.instagram.com, NO graph.facebook.com: es el error mas
  // comun de esta integracion y devuelve un fallo de permisos que despista.
  const res = await fetchJson(
    `${IG_GRAPH_BASE}/${IG_GRAPH_VERSION}/${credentials.igUserId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const id = (res as { message_id?: string }).message_id ?? `ig_${Date.now()}`;
  return { platformMessageId: String(id) };
}

/**
 * Traduce los fallos de ambas plataformas al MetaApiError que el resto del
 * CRM ya sabe interpretar (incluido `isAuthError`, que distingue token muerto
 * de hipo transitorio y costó un incidente aprender).
 */
async function fetchJson(
  url: string,
  init: RequestInit
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (cause) {
    throw new MetaApiError("No se pudo contactar la API de Instagram", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo
  }

  if (!res.ok) {
    const err = json as
      | { error?: { message?: string; code?: number } | string }
      | null;
    const message =
      typeof err?.error === "string"
        ? err.error
        : err?.error?.message ?? `HTTP ${res.status}`;
    const code = typeof err?.error === "object" ? err.error?.code ?? null : null;
    throw new MetaApiError(message, {
      status: res.status,
      code,
      details: json ?? text,
    });
  }
  return json;
}
