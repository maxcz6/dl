import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { columnasDelSecreto, secretoDeLaFila } from "@/server/zernio/secreto-guardado";

/**
 * 022 — Credenciales del canal de TikTok.
 *
 * Una sola fuente: la API unificada de Zernio (su llave, y el enrutado por
 * `accountRef`). Mismo contrato que las de los demás canales: la llave viaja
 * descifrada solo en memoria y nunca sale en una respuesta de la API — hacia
 * fuera se expone su cola.
 */

export type TiktokCredentials = {
  id: string;
  organizationId: string;
  source: "zernio";
  /** `accountId` de la cuenta de TikTok en Zernio. */
  accountRef: string;
  username: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.tiktokCredentials.$inferSelect;

function toCredentials(row: Row): TiktokCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
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

export async function getTiktokCredentialsByOrg(
  organizationId: string
): Promise<TiktokCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.tiktokCredentials)
    .where(eq(schema.tiktokCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`. */
export async function getTiktokCredentialsByAccountRef(
  accountRef: string
): Promise<TiktokCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.tiktokCredentials)
    .where(eq(schema.tiktokCredentials.accountRef, accountRef))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveTiktokCredentials(input: {
  organizationId: string;
  accountRef: string;
  username: string | null;
  token: string;
  webhookSecret: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const existing = await getTiktokCredentialsByOrg(input.organizationId);

  const values = {
    organizationId: input.organizationId,
    source: "zernio" as const,
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
      .update(schema.tiktokCredentials)
      .set(values)
      .where(eq(schema.tiktokCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.tiktokCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** La llave murió: se pausan los envíos y la UI pide reconectar. */
export async function markTiktokReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.tiktokCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(eq(schema.tiktokCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
