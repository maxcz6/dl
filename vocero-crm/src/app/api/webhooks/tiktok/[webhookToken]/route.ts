import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidWebhookToken } from "@/server/inbox/webhook";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { zernioSignatureFrom } from "@/server/zernio";
import { isAuthenticZernioDelivery, processZernioPayload } from "@/server/zernio/dispatch";

/**
 * 022 — Webhook público del canal de TikTok.
 *
 * Mismo patrón de dos capas que los demás: el segmento [webhookToken] debe
 * coincidir (si no → 404 sin efectos) y encima la firma. Aquí solo hay una
 * fuente, Zernio: TikTok no entrega mensajes a una app propia.
 *
 * Zernio entrega TODAS las plataformas de una llave por un mismo webhook, así
 * que esta URL también recibe Instagram y Messenger si esas cuentas están
 * conectadas: `processZernioPayload` reparte por plataforma, igual que hacen
 * las otras dos rutas con un evento de TikTok.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

/** Zernio no hace handshake; esto sirve para comprobar la URL a mano. */
export async function GET(_req: Request, { params }: Params) {
  if (!isChannelEnabled("tiktok")) return channelDisabledResponse();
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, getEnv().META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function POST(req: Request, { params }: Params) {
  if (!isChannelEnabled("tiktok")) return channelDisabledResponse();
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, getEnv().META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const rawBody = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Cuerpo ilegible: 200 igualmente para que la fuente no reintente en vano.
    return Response.json({ received: true });
  }

  // La firma se valida contra los secretos de la organización dueña de ESTA
  // cuenta, que hay que resolver leyendo el cuerpo primero (023). Sin esta capa, quien conozca la URL puede
  // inyectar mensajes falsos y hacer que el agente conteste de verdad.
  if (!(await isAuthenticZernioDelivery(rawBody, zernioSignatureFrom(req.headers)))) {
    return new Response(null, { status: 401 });
  }

  // Zernio corta a los 5 segundos y reintenta: se acusa recibo YA y se procesa
  // fuera de la ruta.
  after(async () => {
    try {
      await processZernioPayload(payload);
    } catch (err) {
      console.error("[tiktok] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}
