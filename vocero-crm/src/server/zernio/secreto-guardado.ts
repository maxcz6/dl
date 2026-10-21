import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * 030 — El secreto de firma de Zernio, cifrado en reposo.
 *
 * Instagram, Messenger y TikTok guardan el secreto HMAC de las entregas de
 * Zernio en tres columnas cifradas (`webhook_secret_{cipher,iv,tag}`), con el
 * mismo AES-256-GCM que el token de la fila. Hasta la 1.6 iba en claro en
 * `webhook_secret`: esa columna ya no se escribe, solo se lee de respaldo
 * mientras el arranque no la haya cifrado (spec 030, D5), y se quita en una
 * versión mayor (D6).
 */

type ColumnasDelSecreto = {
  webhookSecret: string | null;
  webhookSecretCipher: string | null;
  webhookSecretIv: string | null;
  webhookSecretTag: string | null;
};

/**
 * Lo que se escribe en la fila para guardar `secret`: cifrado, y la columna
 * vieja en nulo. Es la única puerta que escribe estas columnas.
 */
export function columnasDelSecreto(secret: string | null): ColumnasDelSecreto {
  if (!secret) {
    return {
      webhookSecret: null,
      webhookSecretCipher: null,
      webhookSecretIv: null,
      webhookSecretTag: null,
    };
  }
  const enc = encryptSecret(secret);
  return {
    webhookSecret: null,
    webhookSecretCipher: enc.cipher,
    webhookSecretIv: enc.iv,
    webhookSecretTag: enc.tag,
  };
}

/** El secreto de una fila: el cifrado si lo hay; si no, el que quedó en claro. */
export function secretoDeLaFila(row: ColumnasDelSecreto): string | null {
  if (row.webhookSecretCipher && row.webhookSecretIv && row.webhookSecretTag) {
    return decryptSecret({
      cipher: row.webhookSecretCipher,
      iv: row.webhookSecretIv,
      tag: row.webhookSecretTag,
    });
  }
  return row.webhookSecret || null;
}

const TABLAS = [
  schema.instagramCredentials,
  schema.messengerCredentials,
  schema.tiktokCredentials,
] as const;

/**
 * Cifra los secretos que una versión anterior dejó en claro. Re-ejecutable:
 * solo mira filas con `webhook_secret`, y cada una se escribe con la condición
 * de que siga teniendo el valor leído, así que un secreto guardado entre la
 * lectura y la escritura (que ya llega cifrado) no se pisa. Devuelve cuántas
 * filas cifró; nunca dice cuáles ni con qué.
 */
export async function cifrarSecretosEnClaro(): Promise<number> {
  const db = getDb();
  let cifrados = 0;
  for (const tabla of TABLAS) {
    const filas = await db
      .select({ id: tabla.id, secreto: tabla.webhookSecret })
      .from(tabla)
      .where(isNotNull(tabla.webhookSecret));
    for (const fila of filas) {
      if (fila.secreto === null) continue;
      const hechas = await db
        .update(tabla)
        .set(columnasDelSecreto(fila.secreto))
        .where(and(eq(tabla.id, fila.id), eq(tabla.webhookSecret, fila.secreto)))
        .returning({ id: tabla.id });
      // Un "" se limpia igual, pero no era un secreto.
      if (fila.secreto) cifrados += hechas.length;
    }
  }
  return cifrados;
}
