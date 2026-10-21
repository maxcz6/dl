import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { columnasDelSecreto, secretoDeLaFila } from "@/server/zernio/secreto-guardado";

/**
 * 017 — Credenciales del canal de Messenger.
 *
 * Dos fuentes, como en Instagram: la API unificada de Zernio (una llave, y el
 * enrutado por `accountRef`) o una app propia de Meta (token de la página, y
 * el enrutado por `pageId`). El token viaja descifrado solo en memoria y nunca
 * sale en una respuesta de la API — hacia fuera se expone su cola.
 */

export type MessengerCredentials = {
  id: string;
  organizationId: string;
  source: "zernio" | "meta";
  /** ID de la página de Facebook. En modo Zernio puede no conocerse. */
  pageId: string | null;
  pageName: string | null;
  /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
  accountRef: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.messengerCredentials.$inferSelect;

function toCredentials(row: Row): MessengerCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    pageId: row.pageId,
    pageName: row.pageName,
    accountRef: row.accountRef,
    webhookSecret: secretoDeLaFila(row),
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

export async function getMessengerCredentialsByOrg(
  organizationId: string
): Promise<MessengerCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.messengerCredentials)
    .where(eq(schema.messengerCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Meta: `entry[].id` es el ID de la página. */
export async function getMessengerCredentialsByPageId(
  pageId: string
): Promise<MessengerCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.messengerCredentials)
    .where(eq(schema.messengerCredentials.pageId, pageId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`, no la página. */
export async function getMessengerCredentialsByAccountRef(
  accountRef: string
): Promise<MessengerCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.messengerCredentials)
    .where(eq(schema.messengerCredentials.accountRef, accountRef))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveMessengerCredentials(input: {
  organizationId: string;
  source: "zernio" | "meta";
  pageId: string | null;
  pageName: string | null;
  accountRef: string | null;
  token: string;
  webhookSecret: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const existing = await getMessengerCredentialsByOrg(input.organizationId);

  const values = {
    organizationId: input.organizationId,
    source: input.source,
    pageId: input.pageId,
    pageName: input.pageName,
    accountRef: input.accountRef,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    ...columnasDelSecreto(input.webhookSecret),
    status: "connected" as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.messengerCredentials)
      .set(values)
      .where(eq(schema.messengerCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.messengerCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markMessengerReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.messengerCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(eq(schema.messengerCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
