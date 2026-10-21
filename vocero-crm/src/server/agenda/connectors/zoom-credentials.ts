import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * 015 — Credenciales de la app Server-to-Server de Zoom del propio negocio.
 *
 * Mismo mecanismo de cifrado que el token de WhatsApp: un segundo mecanismo
 * sería un segundo mecanismo que auditar. Hacia fuera solo salen los últimos 4
 * del secreto.
 */

export type ZoomCreds = {
  accountId: string;
  clientId: string;
  clientSecret: string;
  status: "connected" | "error";
};

export async function getZoomCredentials(
  organizationId: string
): Promise<ZoomCreds | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.zoomCredentials)
    .where(scoped(schema.zoomCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    accountId: row.accountId,
    clientId: row.clientId,
    clientSecret: decryptSecret({
      cipher: row.secretCipher,
      iv: row.secretIv,
      tag: row.secretTag,
    }),
    status: row.status,
  };
}

export async function saveZoomCredentials(input: {
  organizationId: string;
  accountId: string;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.clientSecret);
  const values = {
    accountId: input.accountId,
    clientId: input.clientId,
    secretCipher: enc.cipher,
    secretIv: enc.iv,
    secretTag: enc.tag,
    status: "connected" as const,
  };
  await db
    .insert(schema.zoomCredentials)
    .values({
      id: newId("zoomCredentials"),
      organizationId: input.organizationId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [schema.zoomCredentials.organizationId],
      set: { ...values, updatedAt: new Date() },
    });
  // El token cacheado se emitió con las credenciales viejas.
  clearZoomTokenCache();
}

export async function deleteZoomCredentials(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.zoomCredentials)
    .where(scoped(schema.zoomCredentials.organizationId, organizationId));
  clearZoomTokenCache();
}

/**
 * Marca la conexión como rota. Se ESCRIBE de verdad, en el momento en que el
 * proveedor rechaza la autenticación: si nadie lo escribiera, el dueño se
 * enteraría por el cliente que no recibió su enlace.
 */
export async function markZoomError(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.zoomCredentials)
    .set({ status: "error", updatedAt: new Date() })
    .where(scoped(schema.zoomCredentials.organizationId, organizationId));
}

/** Últimos 4 del secreto, para la UI. Jamás el secreto. */
export function secretLast4(secret: string): string {
  return secret.slice(-4);
}

/* --------------------------------------------------------------------------
 * Caché del token de acceso, por proceso.
 *
 * Zoom emite un token de vida corta por cada llamada al endpoint de OAuth;
 * pedir uno nuevo en cada cita es una llamada de red de más y un límite de tasa
 * que se acerca. Se renueva 60 s antes de expirar, y se invalida al cambiar o
 * borrar las credenciales.
 * ------------------------------------------------------------------------ */

type CachedToken = { token: string; expiresAtMs: number };

const globalForZoom = globalThis as unknown as {
  __zoomTokens?: Map<string, CachedToken>;
};

function tokenCache(): Map<string, CachedToken> {
  if (!globalForZoom.__zoomTokens) globalForZoom.__zoomTokens = new Map();
  return globalForZoom.__zoomTokens;
}

export function getCachedZoomToken(key: string): string | null {
  const hit = tokenCache().get(key);
  if (!hit) return null;
  if (hit.expiresAtMs <= Date.now()) {
    tokenCache().delete(key);
    return null;
  }
  return hit.token;
}

export function setCachedZoomToken(
  key: string,
  token: string,
  expiresInSeconds: number
): void {
  const ttl = Math.max(30, expiresInSeconds - 60) * 1000;
  tokenCache().set(key, { token, expiresAtMs: Date.now() + ttl });
}

export function clearZoomTokenCache(): void {
  tokenCache().clear();
}
