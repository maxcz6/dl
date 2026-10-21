import { eq, max } from "drizzle-orm";
import { CHANNEL_ORDER, type Channel } from "@/lib/channels";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { enabledChannels } from "@/server/channels/enabled";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";
import { getMessengerCredentialsByOrg } from "@/server/messenger/credentials";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { webhookVerifyToken } from "@/server/whatsapp/webhook-url";
import {
  zernioConnectionsOfOrg,
  type ZernioConnection,
} from "@/server/zernio/conexiones";
import {
  accountHealth,
  fetchZernioAccounts,
  zernioAccountName,
  type Health,
  type ZernioAccount,
} from "@/server/zernio/cuentas";
import {
  fetchZernioWebhooks,
  webhookHealth,
  type WebhookHealth,
  type ZernioWebhook,
} from "@/server/zernio/webhooks";

/**
 * 023 — El estado de los canales de una organización, para Ajustes → Canales.
 *
 * Tres preguntas por canal: ¿está conectado?, ¿cuándo entró el último
 * mensaje? y, si llega por Zernio, ¿siguen bien la cuenta y el webhook? Las
 * dos primeras salen de la base; la tercera se le pregunta a Zernio en ese
 * momento, con la llave ya guardada, y si Zernio no contesta se dice eso en
 * vez de inventar un «todo bien».
 */

export type ChannelStatus = {
  channel: Channel;
  connected: boolean;
  source: "meta" | "zernio" | null;
  /** La cuenta, el número o la página, como lo reconoce una persona. */
  account: string | null;
  status: "connected" | "reconnect_required" | null;
  /** ISO-8601 del último mensaje de un cliente por ese canal; null si ninguno. */
  lastInboundAt: string | null;
  /** Solo con fuente Zernio. */
  health: { account: Health; webhook: WebhookHealth } | null;
};

const SIN_ZERNIO: Health = {
  level: "warn",
  message: "No se pudo consultar a Zernio ahora mismo. Vuelve a intentarlo en un momento.",
};

/** Cuándo entró el último mensaje de un cliente por cada canal (sin el Laboratorio). */
async function lastInboundByChannel(
  organizationId: string
): Promise<Partial<Record<Channel, string>>> {
  const rows = await getDb()
    .select({
      channel: schema.conversation.channel,
      last: max(schema.conversation.lastInboundAt),
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false)
      )
    )
    .groupBy(schema.conversation.channel);
  const out: Partial<Record<Channel, string>> = {};
  for (const r of rows) if (r.last) out[r.channel] = r.last.toISOString();
  return out;
}

type Lectura = { accounts: ZernioAccount[]; webhooks: ZernioWebhook[] } | null;

/** Lo que Zernio sabe de una llave; null si no contestó. */
async function leerZernio(token: string): Promise<Lectura> {
  try {
    const [accounts, webhooks] = await Promise.all([
      fetchZernioAccounts(token),
      fetchZernioWebhooks(token),
    ]);
    return { accounts, webhooks };
  } catch {
    return null;
  }
}

function saludDe(conn: ZernioConnection, lectura: Lectura): ChannelStatus["health"] {
  if (!lectura) {
    return {
      account: SIN_ZERNIO,
      webhook: { ...SIN_ZERNIO, lastFiredAt: null, failureCount: 0 },
    };
  }
  return {
    account: accountHealth(
      lectura.accounts.find((a) => a._id === conn.accountRef) ?? null,
      conn.channel
    ),
    webhook: webhookHealth(lectura.webhooks, webhookVerifyToken(), conn.accountRef),
  };
}

export async function channelsStatus(organizationId: string): Promise<ChannelStatus[]> {
  const encendidos = enabledChannels();
  const [ultimos, wa, ig, fb, zernio] = await Promise.all([
    lastInboundByChannel(organizationId),
    getCredentialsByOrg(organizationId),
    encendidos.has("instagram") ? getInstagramCredentialsByOrg(organizationId) : null,
    encendidos.has("messenger") ? getMessengerCredentialsByOrg(organizationId) : null,
    zernioConnectionsOfOrg(organizationId),
  ]);

  // Una lectura por llave, no por canal: lo normal es que los tres compartan una.
  const llaves = [...new Set(zernio.map((c) => c.token))];
  const lecturas = new Map<string, Lectura>(
    await Promise.all(llaves.map(async (t) => [t, await leerZernio(t)] as const))
  );

  const filas: ChannelStatus[] = [];
  for (const channel of CHANNEL_ORDER) {
    if (!encendidos.has(channel)) continue;
    const base = { channel, lastInboundAt: ultimos[channel] ?? null };

    if (channel === "whatsapp") {
      filas.push({
        ...base,
        connected: Boolean(wa),
        source: wa ? "meta" : null,
        account: wa?.displayPhoneNumber ?? null,
        status: wa?.status ?? null,
        health: null,
      });
      continue;
    }

    const conn = zernio.find((c) => c.channel === channel);
    if (conn) {
      const lectura = lecturas.get(conn.token) ?? null;
      // Una conexión guardada antes de la 1.6 puede no tener nombre (Messenger
      // por Zernio no lo pedía): se enseña el que tiene Zernio ahora.
      const enZernio = lectura?.accounts.find((a) => a._id === conn.accountRef);
      filas.push({
        ...base,
        connected: true,
        source: "zernio",
        account: conn.name ?? (enZernio ? zernioAccountName(enZernio) : null),
        status: conn.status,
        health: saludDe(conn, lectura),
      });
      continue;
    }

    // Fuente Meta (app propia): el estado guardado, que cambia cuando un envío
    // falla por credenciales.
    const meta =
      channel === "instagram" && ig?.source === "meta"
        ? { account: ig.username ? `@${ig.username}` : ig.igUserId, status: ig.status }
        : channel === "messenger" && fb?.source === "meta"
          ? { account: fb.pageName ?? fb.pageId, status: fb.status }
          : null;
    filas.push({
      ...base,
      connected: Boolean(meta),
      source: meta ? "meta" : null,
      account: meta?.account ?? null,
      status: meta?.status ?? null,
      health: null,
    });
  }
  return filas;
}
