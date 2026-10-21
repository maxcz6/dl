import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { last4, type AiProviderId, type AiStatus } from "@/lib/ai/presets";

/**
 * La credencial del proveedor de IA de la organización (puerto de
 * `ai_credentials` de Vocero Cloud, issue #85).
 *
 * Mismo patrón que `server/whatsapp/credentials.ts`: cifrado AES-256-GCM en
 * reposo y hacia fuera solo los últimos 4 caracteres. La resolución «la fila
 * manda, el entorno es respaldo» vive en `lib/ai/provider.ts`; aquí solo la
 * fila.
 */

/** Lo que puede salir hacia el cliente. NUNCA incluye el token. */
export type AiCredentialPublic = {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  tokenLast4: string;
  status: AiStatus;
  statusReason: string | null;
  statusChangedAt: Date | null;
  updatedAt: Date;
};

/** Para el adaptador: la misma fila con el token en claro. */
export type AiCredentialSecret = AiCredentialPublic & { token: string };

type Row = typeof schema.aiCredentials.$inferSelect;

function toPublic(row: Row): AiCredentialPublic {
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    tokenLast4: row.tokenLast4,
    status: row.status,
    statusReason: row.statusReason,
    statusChangedAt: row.statusChangedAt,
    updatedAt: row.updatedAt,
  };
}

async function rowDe(organizationId: string): Promise<Row | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAiCredentialPublic(
  organizationId: string
): Promise<AiCredentialPublic | null> {
  const row = await rowDe(organizationId);
  return row ? toPublic(row) : null;
}

/**
 * La fila con el token en claro, ESTÉ COMO ESTÉ: quien decide si una
 * credencial pausada se usa es la resolución, no esta lectura.
 */
export async function getAiCredentialSecret(
  organizationId: string
): Promise<AiCredentialSecret | null> {
  const row = await rowDe(organizationId);
  if (!row) return null;
  return {
    ...toPublic(row),
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

export class AiCredentialError extends Error {
  constructor(readonly code: "sin_token") {
    super(
      "No hay una llave guardada: pega la llave del proveedor para configurar la IA"
    );
    this.name = "AiCredentialError";
  }
}

/**
 * Guarda (o reemplaza) la configuración de la organización.
 *
 * Con token: se cifra, se guarda y el estado VUELVE A `active`. Si el dueño
 * pegó una llave nueva es porque cree que la anterior estaba mal; dejarla
 * pausada sería que arregla el problema y su agente sigue mudo sin motivo
 * visible.
 *
 * Sin token: solo cambia proveedor, base URL o modelo sobre la fila que ya
 * existe, con su llave y su estado tal cual. Cambiar de modelo no arregla una
 * llave rechazada, así que no se finge que sí.
 */
export async function saveAiCredential(input: {
  organizationId: string;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  token?: string;
}): Promise<AiCredentialPublic> {
  const db = getDb();
  const now = new Date();

  if (input.token === undefined) {
    const updated = await db
      .update(schema.aiCredentials)
      .set({
        provider: input.provider,
        baseUrl: input.baseUrl,
        model: input.model,
        updatedAt: now,
      })
      .where(scoped(schema.aiCredentials.organizationId, input.organizationId))
      .returning();
    const row = updated[0];
    if (!row) throw new AiCredentialError("sin_token");
    return toPublic(row);
  }

  const enc = encryptSecret(input.token);
  const valores = {
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    tokenLast4: last4(input.token),
    status: "active" as const,
    statusReason: null,
    statusChangedAt: now,
    updatedAt: now,
  };
  const rows = await db
    .insert(schema.aiCredentials)
    .values({
      id: newId("aiCredentials"),
      organizationId: input.organizationId,
      ...valores,
    })
    .onConflictDoUpdate({
      target: [schema.aiCredentials.organizationId],
      set: valores,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("no se pudo leer la credencial recién guardada");
  return toPublic(row);
}

export async function deleteAiCredential(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.aiCredentials)
    .where(scoped(schema.aiCredentials.organizationId, organizationId));
}

/**
 * Qué hacer con el estado según lo que respondió el proveedor.
 *
 * Función PURA para poder probar la tabla de decisión sin base de datos: es
 * una de esas reglas que se ven obvias y se implementan mal.
 *
 * - **401** → la llave no sirve. Pausa.
 * - **402** → sin saldo. Pausa, con otro motivo: al dueño le sirve saber si
 *   tiene que cambiar la llave o recargar la cuenta.
 * - **429** → límite de TASA, no falta de crédito. **No pausa**: confundirlos
 *   apagaría el agente por una ráfaga de tráfico, justo cuando más se necesita.
 * - Cualquier otro error (500 del proveedor, timeout, red) → tampoco pausa.
 *   Un hipo del proveedor no es un problema de la credencial.
 */
export function estadoSegunRespuesta(httpStatus: number): AiStatus | null {
  if (httpStatus === 401) return "paused_invalid_token";
  if (httpStatus === 402) return "paused_no_credit";
  return null;
}

/** Aplica la pausa que dicte el proveedor. Devuelve true si pausó. */
export async function marcarEstadoPorRespuesta(
  organizationId: string,
  httpStatus: number,
  detalle?: string
): Promise<boolean> {
  const nuevo = estadoSegunRespuesta(httpStatus);
  if (!nuevo) return false;
  const db = getDb();
  await db
    .update(schema.aiCredentials)
    .set({
      status: nuevo,
      statusReason: detalle?.slice(0, 200) ?? null,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scoped(schema.aiCredentials.organizationId, organizationId));
  return true;
}

/**
 * El proveedor aceptó la llave guardada (botón «Probar conexión»): si estaba
 * pausada, vuelve a `active`. Es el camino de «recargué saldo y quiero que
 * vuelva a contestar» sin tener que pegar la misma llave otra vez.
 */
export async function marcarActiva(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.aiCredentials)
    .set({
      status: "active",
      statusReason: null,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scoped(schema.aiCredentials.organizationId, organizationId));
}
