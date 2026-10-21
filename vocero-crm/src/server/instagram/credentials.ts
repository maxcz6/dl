import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { columnasDelSecreto, secretoDeLaFila } from "@/server/zernio/secreto-guardado";

/**
 * 014 — Credenciales del canal de Instagram.
 *
 * Mismo contrato que las de WhatsApp (`server/whatsapp/credentials.ts`): el
 * token viaja descifrado solo en memoria y nunca sale en una respuesta de la
 * API — hacia fuera se expone únicamente su cola.
 */

export type InstagramCredentials = {
  id: string;
  organizationId: string;
  source: "zernio" | "meta";
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.instagramCredentials.$inferSelect;

function toCredentials(row: Row): InstagramCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    igUserId: row.igUserId,
    accountRef: row.accountRef,
    username: row.username,
    webhookSecret: secretoDeLaFila(row),
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

export async function getInstagramCredentialsByOrg(
  organizationId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Meta: `entry[].id` es el IG_ID del perfil. */
export async function getInstagramCredentialsByIgUserId(
  igUserId: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.igUserId, igUserId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`, no el perfil. */
export async function getInstagramCredentialsByAccountRef(
  accountRef: string
): Promise<InstagramCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.instagramCredentials)
    .where(eq(schema.instagramCredentials.accountRef, accountRef))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveInstagramCredentials(input: {
  organizationId: string;
  source: "zernio" | "meta";
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  token: string;
  webhookSecret: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const existing = await getInstagramCredentialsByOrg(input.organizationId);

  const values = {
    organizationId: input.organizationId,
    source: input.source,
    igUserId: input.igUserId,
    accountRef: input.accountRef,
    username: input.username,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    ...columnasDelSecreto(input.webhookSecret),
    status: "connected" as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.instagramCredentials)
      .set(values)
      .where(eq(schema.instagramCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.instagramCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markInstagramReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.instagramCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(eq(schema.instagramCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
