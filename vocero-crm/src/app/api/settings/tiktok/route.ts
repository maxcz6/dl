import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import {
  getTiktokCredentialsByOrg,
  saveTiktokCredentials,
  tokenLast4,
} from "@/server/tiktok/credentials";
import { ensureWebhookForOrg } from "@/server/zernio/conexiones";
import { accountHealth, zernioAccountName } from "@/server/zernio/cuentas";
import { resolveZernioAccount } from "@/server/zernio/guardar";

export const dynamic = "force-dynamic";

/** 022 — Estado de la conexión de TikTok (la llave nunca sale entera). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("tiktok")) return channelDisabledResponse();
  const creds = await getTiktokCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      accountRef: creds.accountRef,
      username: creds.username,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
      hasWebhookSecret: Boolean(creds.webhookSecret),
    },
  });
});

const putSchema = z.object({
  /**
   * `accountId` de la cuenta de TikTok en Zernio. Opcional si la llave tiene
   * una sola cuenta de TikTok (023).
   */
  accountRef: z.string().trim().min(1).nullish(),
  /** Usuario de TikTok, solo para enseñarlo: no enruta nada. */
  username: z.string().trim().min(1).max(100).nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES la llave contra Zernio, igual que los
 * demás canales: una llave que no sirve no llega a la base. Solo el
 * propietario de la organización puede hacerlo.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("tiktok")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar TikTok");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  // 023: la cuenta se resuelve contra Zernio, no se guarda a ciegas.
  const cuenta = await resolveZernioAccount(body.data.token, body.data.accountRef, "tiktok");
  if (!cuenta.ok) return cuenta.response;

  const previa = await getTiktokCredentialsByOrg(session.organizationId);
  const username =
    (cuenta.account.username ?? body.data.username)?.replace(/^@/, "") || null;
  await saveTiktokCredentials({
    organizationId: session.organizationId,
    accountRef: cuenta.account._id,
    username,
    token: body.data.token,
    // Sin secreto nuevo se conserva el que había: reconectar no debe apagar
    // la verificación de firma.
    webhookSecret: body.data.webhookSecret ?? previa?.webhookSecret ?? null,
  });
  const webhook = await ensureWebhookForOrg(session.organizationId, {
      secret: body.data.webhookSecret,
    });

  return Response.json({
    ok: true,
    username,
    accountRef: cuenta.account._id,
    accountName: zernioAccountName(cuenta.account),
    // Una cuenta personal se guarda igual, pero se dice: TikTok no le entrega
    // mensajes hasta que sea Business.
    health: accountHealth(cuenta.account, "tiktok"),
    webhook,
  });
});
