import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getInstagramCredentialsByOrg,
  saveInstagramCredentials,
  tokenLast4,
} from "@/server/instagram/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { ensureWebhookForOrg } from "@/server/zernio/conexiones";
import { accountHealth, zernioAccountName } from "@/server/zernio/cuentas";
import { resolveZernioAccount } from "@/server/zernio/guardar";

export const dynamic = "force-dynamic";

/** 014 — Estado de la conexión de Instagram (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  const creds = await getInstagramCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      igUserId: creds.igUserId,
      accountRef: creds.accountRef,
      username: creds.username,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]),
  /** Con Meta, obligatorio. Con Zernio sale de la cuenta (023). */
  igUserId: z.string().trim().min(1).nullish(),
  /** Con Zernio: opcional si la llave tiene una sola cuenta de Instagram. */
  accountRef: z.string().trim().min(1).nullish(),
  username: z.string().trim().nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma, igual que el
 * wizard de WhatsApp: un token que no sirve no llega a la base. Solo el
 * propietario de la organización puede hacerlo (023: esta ruta no lo
 * revisaba; Messenger y TikTok sí).
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("instagram")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar Instagram");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const data = body.data;

  const previa = await getInstagramCredentialsByOrg(session.organizationId);
  // Sin secreto nuevo se conserva el que había: reconectar no debe apagar la
  // verificación de firma.
  const webhookSecret =
    data.webhookSecret ??
    (previa?.source === data.source ? previa.webhookSecret : null) ??
    null;

  if (data.source === "zernio") {
    // 023: la cuenta se resuelve contra Zernio, no se guarda a ciegas.
    const cuenta = await resolveZernioAccount(data.token, data.accountRef, "instagram");
    if (!cuenta.ok) return cuenta.response;
    const username = cuenta.account.username?.replace(/^@/, "") || data.username || null;

    await saveInstagramCredentials({
      organizationId: session.organizationId,
      source: "zernio",
      igUserId: cuenta.account.platformUserId || data.igUserId || cuenta.account._id,
      accountRef: cuenta.account._id,
      username,
      token: data.token,
      webhookSecret,
    });
    const webhook = await ensureWebhookForOrg(session.organizationId, {
      secret: data.webhookSecret,
    });
    return Response.json({
      ok: true,
      username,
      accountRef: cuenta.account._id,
      accountName: zernioAccountName(cuenta.account),
      health: accountHealth(cuenta.account, "instagram"),
      webhook,
    });
  }

  if (!data.igUserId) {
    return apiError(
      422,
      "invalid_body",
      "Con una app propia de Meta hace falta el ID de la cuenta de Instagram"
    );
  }
  const check = await verify({ token: data.token, igUserId: data.igUserId });
  if (!check.ok) {
    return apiError(check.status, check.code, check.message);
  }

  await saveInstagramCredentials({
    organizationId: session.organizationId,
    source: "meta",
    igUserId: data.igUserId,
    accountRef: null,
    username: check.username ?? data.username ?? null,
    token: data.token,
    webhookSecret,
  });

  return Response.json({ ok: true, username: check.username ?? null });
});

type Check =
  | { ok: true; username: string | null }
  | { ok: false; status: number; code: string; message: string };

/** Fuente Meta: el token tiene que ser de ESA cuenta de Instagram. */
async function verify(data: { token: string; igUserId: string }): Promise<Check> {
  const url = `${process.env.IG_GRAPH_BASE_URL ?? "https://graph.instagram.com"}/${
    process.env.META_GRAPH_API_VERSION ?? "v25.0"
  }/me?fields=id,username`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: "platform_unavailable",
      message: "No se pudo contactar la plataforma; intenta de nuevo",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: 422,
      code: "invalid_token",
      message: "El token de Instagram no es válido o no tiene permiso de mensajes",
    };
  }

  const json = (await res.json().catch(() => null)) as {
    id?: string;
    username?: string;
  } | null;
  if (json?.id && json.id !== data.igUserId) {
    return {
      ok: false,
      status: 422,
      code: "id_mismatch",
      message: `El IG_ID del token es ${json.id}, no ${data.igUserId}`,
    };
  }
  return { ok: true, username: json?.username ?? null };
}
