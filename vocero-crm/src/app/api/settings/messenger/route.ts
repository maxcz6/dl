import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  getMessengerCredentialsByOrg,
  saveMessengerCredentials,
  tokenLast4,
} from "@/server/messenger/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { ensureWebhookForOrg } from "@/server/zernio/conexiones";
import { accountHealth, zernioAccountName } from "@/server/zernio/cuentas";
import { resolveZernioAccount } from "@/server/zernio/guardar";

export const dynamic = "force-dynamic";

/** 017 — Estado de la conexión de Messenger (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();
  const creds = await getMessengerCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      pageId: creds.pageId,
      pageName: creds.pageName,
      accountRef: creds.accountRef,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]).default("meta"),
  pageId: z.string().trim().min(1).nullish(),
  accountRef: z.string().trim().min(1).nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma, igual que el wizard
 * de WhatsApp: un token que no sirve no llega a la base. Solo el propietario
 * de la organización puede hacerlo.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!isChannelEnabled("messenger")) return channelDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar la página");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  // `.default()` deja el tipo opcional aunque Zod siempre lo rellene: se fija
  // aquí para que el resto del handler trabaje con un valor cerrado.
  const data = { ...body.data, source: body.data.source ?? "meta" };

  if (data.source === "meta" && !data.pageId) {
    return apiError(
      422,
      "invalid_body",
      "En modo Meta hace falta el ID de la página"
    );
  }

  const previa = await getMessengerCredentialsByOrg(session.organizationId);
  // Sin secreto nuevo se conserva el que había: reconectar no debe apagar la
  // verificación de firma.
  const webhookSecret =
    data.webhookSecret ??
    (previa?.source === data.source ? previa.webhookSecret : null) ??
    null;

  if (data.source === "zernio") {
    // 023: la cuenta se resuelve contra Zernio, no se guarda a ciegas. De ahí
    // salen también la página y su nombre.
    const cuenta = await resolveZernioAccount(data.token, data.accountRef, "messenger");
    if (!cuenta.ok) return cuenta.response;
    const pageName = zernioAccountName(cuenta.account);

    await saveMessengerCredentials({
      organizationId: session.organizationId,
      source: "zernio",
      pageId: cuenta.account.metadata?.selectedPageId ?? data.pageId ?? null,
      pageName,
      accountRef: cuenta.account._id,
      token: data.token,
      webhookSecret,
    });
    const webhook = await ensureWebhookForOrg(session.organizationId, {
      secret: data.webhookSecret,
    });
    return Response.json({
      ok: true,
      pageName,
      accountRef: cuenta.account._id,
      accountName: pageName,
      health: accountHealth(cuenta.account, "messenger"),
      webhook,
    });
  }

  const check = await verify(data);
  if (!check.ok) return apiError(check.status, check.code, check.message);

  await saveMessengerCredentials({
    organizationId: session.organizationId,
    source: "meta",
    pageId: data.pageId ?? null,
    pageName: check.pageName,
    accountRef: null,
    token: data.token,
    webhookSecret,
  });

  return Response.json({ ok: true, pageName: check.pageName });
});

type Check =
  | { ok: true; pageName: string | null }
  | { ok: false; status: number; code: string; message: string };

type VerifyInput = Omit<z.infer<typeof putSchema>, "source"> & {
  source: "zernio" | "meta";
};

/** Fuente Meta. */
async function verify(data: VerifyInput): Promise<Check> {
  // Meta: el token debe ser de ESA página. Un token de otra guardaría
  // credenciales que reciben webhooks de una y contestan por otra.
  try {
    const res = await graphRequest<{ id?: string; name?: string }>(
      `${data.pageId}?fields=id,name`,
      { token: data.token }
    );
    if (res.id && res.id !== data.pageId) {
      return {
        ok: false,
        status: 422,
        code: "id_mismatch",
        message: `El token pertenece a la página ${res.id}, no a ${data.pageId}`,
      };
    }
    return { ok: true, pageName: res.name?.trim() || null };
  } catch (err) {
    return translate(
      err,
      "El token de la página no es válido o no tiene permiso de mensajes (pages_messaging)"
    );
  }
}

function translate(err: unknown, invalidMessage: string): Check {
  if (err instanceof MetaApiError) {
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        status: 503,
        code: "platform_unavailable",
        message: "No se pudo contactar la plataforma; intenta de nuevo",
      };
    }
    return { ok: false, status: 422, code: "invalid_token", message: invalidMessage };
  }
  throw err;
}
