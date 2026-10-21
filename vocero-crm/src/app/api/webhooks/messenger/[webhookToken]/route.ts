import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidSignature, isValidWebhookToken } from "@/server/inbox/webhook";
import { processMetaPagePayload } from "@/server/messenger/ingest";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { looksLikeMetaPayload, zernioSignatureFrom } from "@/server/zernio";
import { isAuthenticZernioDelivery, processZernioPayload } from "@/server/zernio/dispatch";

/**
 * 017 — Webhook público del canal de Messenger.
 *
 * Mismo patrón de dos capas que los de WhatsApp e Instagram: el segmento
 * [webhookToken] debe coincidir (si no → 404 sin efectos) y encima la firma.
 * Acepta las dos fuentes por la misma URL porque sus payloads son
 * inconfundibles: Meta manda `object: "page"`, Zernio manda un evento plano
 * con `account`.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  // Handshake de Meta (Zernio no lo hace, pero responderlo no estorba).
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
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

  const isMeta = looksLikeMetaPayload(payload, "page");

  if (isMeta) {
    // Meta firma cada entrega con el App Secret. Sin esta capa, quien conozca
    // la URL secreta puede inyectar mensajes falsos: el agente los contestaría
    // enviando un mensaje REAL desde la página al destinatario que el atacante
    // elija.
    if (
      !isValidSignature(
        rawBody,
        req.headers.get("x-hub-signature-256"),
        env.META_APP_SECRET
      )
    ) {
      return new Response(null, { status: 401 });
    }
  } else {
    // Zernio: la firma se valida contra los secretos de la organización dueña
    // de ESTA cuenta, que hay que resolver leyendo el cuerpo primero (023).
    if (!(await isAuthenticZernioDelivery(rawBody, zernioSignatureFrom(req.headers)))) {
      return new Response(null, { status: 401 });
    }
  }

  // Zernio corta a los 5 segundos y reintenta; Meta también. Se acusa recibo
  // YA y se procesa fuera de la ruta.
  after(async () => {
    try {
      // Un evento de Zernio se reparte por plataforma: la misma URL sirve para
      // Instagram y para Messenger, porque Zernio entrega todo por un webhook.
      if (isMeta) await processMetaPagePayload(payload);
      else await processZernioPayload(payload);
    } catch (err) {
      console.error("[messenger] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}
