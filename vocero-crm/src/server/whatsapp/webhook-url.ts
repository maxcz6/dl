import { getEnv } from "@/lib/env";

/**
 * Dónde recibe esta instancia los webhooks de Meta.
 *
 * La URL es fija: `APP_BASE_URL` + `/api/webhooks/<canal>/<verify token>`. El
 * verify token hace de segmento secreto de la ruta (capa 1 del webhook) y es
 * el mismo que Meta manda en el handshake, así que la URL se trata como una
 * contraseña y jamás se escribe entera en un log.
 *
 * Única puerta para construirla: la pantalla que la enseña, el registro
 * automático en Meta y el mock la toman de aquí, para que no haya dos formas
 * de armarla que un día dejen de coincidir.
 */
export type WebhookChannel = "wa" | "ig" | "messenger" | "tiktok";

/** Ruta (sin origen) del webhook de un canal. */
export function webhookPath(channel: WebhookChannel = "wa"): string {
  return `/api/webhooks/${channel}/${getEnv().META_WEBHOOK_VERIFY_TOKEN}`;
}

/** URL pública completa del webhook de un canal. */
export function webhookUrl(channel: WebhookChannel = "wa"): string {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
  return `${base}${webhookPath(channel)}`;
}

/** El verify token que Meta debe mandar en el handshake de cualquier canal. */
export function webhookVerifyToken(): string {
  return getEnv().META_WEBHOOK_VERIFY_TOKEN;
}
