import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";
import { CHANNEL_ORDER } from "@/lib/channels";
import { isChannelEnabled } from "@/server/channels/enabled";
import {
  getInstagramCredentialsByAccountRef,
  getInstagramCredentialsByOrg,
} from "@/server/instagram/credentials";
import {
  getMessengerCredentialsByAccountRef,
  getMessengerCredentialsByOrg,
} from "@/server/messenger/credentials";
import {
  getTiktokCredentialsByAccountRef,
  getTiktokCredentialsByOrg,
} from "@/server/tiktok/credentials";
import {
  webhookUrl,
  webhookVerifyToken,
  type WebhookChannel,
} from "@/server/whatsapp/webhook-url";
import { fetchZernioAccounts, type ZernioChannel } from "@/server/zernio/cuentas";
import { columnasDelSecreto } from "@/server/zernio/secreto-guardado";
import {
  cachedZernioWebhooks,
  ensureZernioWebhook,
  pointsHere,
} from "@/server/zernio/webhooks";

/**
 * 023 — Las conexiones por Zernio de una organización, en una sola forma.
 *
 * Cada canal guarda sus credenciales en su tabla (014, 017, 022), pero para
 * Zernio los tres son lo mismo: una cuenta, una llave y un secreto de firma.
 * Lo que es UNO en Zernio —el webhook y su secreto— se resuelve aquí, una vez,
 * en lugar de tres veces casi iguales.
 */

export const ZERNIO_CHANNELS = CHANNEL_ORDER.filter(
  (c): c is ZernioChannel => c !== "whatsapp"
);

/** Segmento de la ruta del webhook de cada canal. */
const WEBHOOK_PATH: Record<ZernioChannel, WebhookChannel> = {
  instagram: "ig",
  messenger: "messenger",
  tiktok: "tiktok",
};

export type ZernioConnection = {
  channel: ZernioChannel;
  /** Id de la fila de credenciales. */
  id: string;
  organizationId: string;
  accountRef: string;
  token: string;
  webhookSecret: string | null;
  /** Nombre con el que una persona reconoce la cuenta. */
  name: string | null;
  status: "connected" | "reconnect_required";
};

const arroba = (u: string | null) => (u ? `@${u.replace(/^@/, "")}` : null);

async function byOrg(
  channel: ZernioChannel,
  organizationId: string
): Promise<ZernioConnection | null> {
  if (channel === "instagram") {
    const c = await getInstagramCredentialsByOrg(organizationId);
    if (!c || c.source !== "zernio" || !c.accountRef) return null;
    return { channel, ...comun(c), accountRef: c.accountRef, name: arroba(c.username) };
  }
  if (channel === "messenger") {
    const c = await getMessengerCredentialsByOrg(organizationId);
    if (!c || c.source !== "zernio" || !c.accountRef) return null;
    return { channel, ...comun(c), accountRef: c.accountRef, name: c.pageName };
  }
  const c = await getTiktokCredentialsByOrg(organizationId);
  if (!c) return null;
  return { channel, ...comun(c), accountRef: c.accountRef, name: arroba(c.username) };
}

async function byAccountRef(
  channel: ZernioChannel,
  accountRef: string
): Promise<ZernioConnection | null> {
  if (channel === "instagram") {
    const c = await getInstagramCredentialsByAccountRef(accountRef);
    if (!c || c.source !== "zernio" || !c.accountRef) return null;
    return { channel, ...comun(c), accountRef: c.accountRef, name: arroba(c.username) };
  }
  if (channel === "messenger") {
    const c = await getMessengerCredentialsByAccountRef(accountRef);
    if (!c || c.source !== "zernio" || !c.accountRef) return null;
    return { channel, ...comun(c), accountRef: c.accountRef, name: c.pageName };
  }
  const c = await getTiktokCredentialsByAccountRef(accountRef);
  if (!c) return null;
  return { channel, ...comun(c), accountRef: c.accountRef, name: arroba(c.username) };
}

function comun(c: {
  id: string;
  organizationId: string;
  token: string;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
}) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    token: c.token,
    webhookSecret: c.webhookSecret,
    status: c.status,
  };
}

/** Las conexiones por Zernio de los canales ENCENDIDOS de esa organización. */
export async function zernioConnectionsOfOrg(
  organizationId: string
): Promise<ZernioConnection[]> {
  const found = await Promise.all(
    ZERNIO_CHANNELS.filter((c) => isChannelEnabled(c)).map((c) => byOrg(c, organizationId))
  );
  return found.filter((c): c is ZernioConnection => c !== null);
}

type EventAccount = { id?: string; accountId?: string; profileId?: string };

/**
 * La conexión a la que va un evento de Zernio. SOLO LECTURA: se llama antes de
 * verificar la firma, así que no puede cambiar nada. `viaProfile` dice que la
 * fila guardó el id del perfil en vez del de la cuenta.
 */
export async function findZernioConnection(
  channel: ZernioChannel,
  account: EventAccount | undefined
): Promise<{ connection: ZernioConnection; viaProfile: boolean } | null> {
  const id = account?.id ?? account?.accountId;
  if (!id) return null;
  const directa = await byAccountRef(channel, id);
  if (directa) return { connection: directa, viaProfile: false };
  if (!account?.profileId) return null;
  const porPerfil = await byAccountRef(channel, account.profileId);
  return porPerfil ? { connection: porPerfil, viaProfile: true } : null;
}

/** 030 — El secreto se escribe cifrado (`columnasDelSecreto`), nunca en claro. */
async function update(
  channel: ZernioChannel,
  id: string,
  set: { accountRef?: string; webhookSecret?: string }
): Promise<void> {
  const { webhookSecret, ...resto } = set;
  const values = {
    ...resto,
    ...(webhookSecret !== undefined ? columnasDelSecreto(webhookSecret) : {}),
    updatedAt: new Date(),
  };
  const db = getDb();
  if (channel === "instagram") {
    await db
      .update(schema.instagramCredentials)
      .set(values)
      .where(eq(schema.instagramCredentials.id, id));
  } else if (channel === "messenger") {
    await db
      .update(schema.messengerCredentials)
      .set(values)
      .where(eq(schema.messengerCredentials.id, id));
  } else {
    await db
      .update(schema.tiktokCredentials)
      .set(values)
      .where(eq(schema.tiktokCredentials.id, id));
  }
}

/**
 * Corrige una fila que guardó el id del perfil. Se llama DESPUÉS de verificar
 * la firma: es un cambio de estado, y uno que mueve por dónde salen los
 * mensajes (el envío usa el mismo campo).
 */
export async function healZernioAccountRef(
  channel: ZernioChannel,
  account: EventAccount | undefined
): Promise<void> {
  const found = await findZernioConnection(channel, account);
  const id = account?.id ?? account?.accountId;
  if (!found?.viaProfile || !id) return;
  await update(channel, found.connection.id, { accountRef: id });
  console.warn(
    `[zernio] la conexión de ${channel} tenía el id del perfil (${account?.profileId}): corregida a la cuenta ${id}`
  );
}

/** Los secretos de firma guardados en los canales por Zernio de esa organización. */
export async function storedZernioSecrets(organizationId: string): Promise<string[]> {
  const conns = await zernioConnectionsOfOrg(organizationId);
  return [...new Set(conns.map((c) => c.webhookSecret).filter((s): s is string => !!s))];
}

/**
 * Puro: qué cuentas lleva el webhook de UNA llave.
 *
 * No son «las conexiones guardadas con esa llave», sino todas las conexiones
 * de la organización cuya cuenta ve esa llave. La diferencia importa cuando
 * dos canales quedaron guardados con llaves distintas de la MISMA cuenta de
 * Zernio (se rotó la llave y solo se reconectó un canal): las dos llaves ven
 * el mismo webhook, y si cada una lo dejara solo con «sus» cuentas, la segunda
 * le quitaría las de la primera y ese canal dejaría de recibir en silencio.
 *
 * Si la llave no ve ninguna (una lista de cuentas que aún no refleja la
 * conexión), se mandan las del grupo y que Zernio decida.
 */
export function webhookAccountIds(
  all: readonly { accountRef: string }[],
  group: readonly { accountRef: string }[],
  visible: ReadonlySet<string>
): string[] {
  const vistas = all.map((c) => c.accountRef).filter((id) => visible.has(id));
  return [...new Set(vistas.length > 0 ? vistas : group.map((c) => c.accountRef))];
}

export type EnsureWebhookResult =
  | { ok: true; created: boolean; accounts: number }
  | { ok: false; code: string; message: string };

/**
 * Da de alta (o actualiza) en Zernio el webhook de esta instancia para las
 * cuentas conectadas a esa organización, y deja el mismo secreto en todos sus
 * canales. Nunca lanza: guardar una conexión no puede fallar porque Zernio
 * tuvo un hipo al registrar el webhook.
 *
 * Una instancia es un negocio (constitución): el límite de cuentas del webhook
 * es el de ESTA organización.
 *
 * `secret` es el que alguien acaba de dar a propósito al guardar una conexión:
 * manda sobre los que ya hubiera, y queda en todos los canales y en Zernio.
 */
export async function ensureWebhookForOrg(
  organizationId: string,
  opts: { secret?: string | null } = {}
): Promise<EnsureWebhookResult> {
  const conns = await zernioConnectionsOfOrg(organizationId);
  if (conns.length === 0) {
    return {
      ok: false,
      code: "sin_conexiones",
      message: "No hay ningún canal conectado por Zernio.",
    };
  }

  const env = getEnv();
  // Zernio tiene que alcanzar la URL desde fuera. `ZERNIO_BASE_URL` solo se
  // define en pruebas (el simulador), y ahí la URL local sí vale.
  const url = webhookUrl(WEBHOOK_PATH[conns[0]!.channel]);
  if (!url.startsWith("https://") && !process.env.ZERNIO_BASE_URL) {
    return {
      ok: false,
      code: "sin_https",
      message:
        "Esta instancia no tiene una URL pública con https (APP_BASE_URL): Zernio no puede entregarle mensajes.",
    };
  }

  const segment = webhookVerifyToken();
  const name = `vocero-${new URL(env.APP_BASE_URL).host}`;
  const acceptableUrls = ZERNIO_CHANNELS.filter((c) => isChannelEnabled(c)).map((c) =>
    webhookUrl(WEBHOOK_PATH[c])
  );

  try {
    // Un secreto para todo: el que se acaba de dar; si no, el que ya esté
    // guardado; si no, el del webhook que ya apunta aquí; si no, uno nuevo.
    let secret =
      opts.secret ||
      (conns.map((c) => c.webhookSecret).find((s): s is string => !!s) ?? null);
    if (!secret) {
      const { webhooks } = await cachedZernioWebhooks(conns[0]!.token);
      secret =
        webhooks.find((w) => pointsHere(w, segment) && w.secret)?.secret ??
        randomBytes(24).toString("hex");
    }

    // Lo normal es una sola llave; si cada canal usa una cuenta de Zernio
    // distinta, cada llave lleva su webhook con sus cuentas.
    const porLlave = new Map<string, ZernioConnection[]>();
    for (const c of conns) porLlave.set(c.token, [...(porLlave.get(c.token) ?? []), c]);

    let created = false;
    const cubiertas = new Set<string>();
    for (const [token, grupo] of porLlave) {
      const visibles = new Set((await fetchZernioAccounts(token)).map((a) => a._id));
      const accountIds = webhookAccountIds(conns, grupo, visibles);
      const r = await ensureZernioWebhook({
        token,
        segment,
        name,
        url,
        acceptableUrls,
        accountIds,
        secret,
      });
      created ||= r.created;
      for (const id of accountIds) cubiertas.add(id);
    }

    for (const c of conns) {
      if (c.webhookSecret !== secret) await update(c.channel, c.id, { webhookSecret: secret });
    }
    return { ok: true, created, accounts: cubiertas.size };
  } catch (err) {
    const caido = err instanceof MetaApiError && (err.status === 0 || err.status >= 500);
    console.warn("[zernio] no se pudo dar de alta el webhook:", err instanceof Error ? err.message : err);
    return caido
      ? {
          ok: false,
          code: "zernio_unavailable",
          message: "No se pudo contactar a Zernio para dar de alta el webhook. Reinténtalo desde Canales → Estado.",
        }
      : {
          ok: false,
          code: "zernio_rejected",
          message: "Zernio no aceptó el webhook. Reinténtalo desde Canales → Estado o créalo a mano en Zernio.",
        };
  }
}
