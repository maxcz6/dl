import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isMockEnabled } from "@/lib/env";
import { publish } from "@/server/events/bus";
import { deleteMediaFile, saveMediaFile } from "@/server/whatsapp/media";

/**
 * 018 — La imagen del creativo, copiada al llegar.
 *
 * La URL que Meta manda en el `referral` caduca en días (el parámetro `oe` de
 * su CDN). Si no se copia en ese momento, la tarjeta del anuncio se queda sin
 * imagen para siempre. Se guarda como un adjunto más —mismo volumen, misma
 * ruta con sesión— y UNA vez por anuncio.
 *
 * Todo aquí es best-effort y corre fuera del camino del webhook: el mensaje del
 * cliente ya está en la bandeja cuando esto empieza, y nada de lo que falle
 * aquí puede tocarlo.
 */

/** El jpg de un creativo ronda 20-150 KB; más que esto no es una miniatura. */
export const CREATIVO_MAX_BYTES = 300_000;
/** Tiempo por intento, contando redirecciones y la lectura del cuerpo. */
const TIEMPO_MS = 5_000;
const MAX_REDIRECCIONES = 3;
/** Espera antes del único reintento: lo justo para un tropiezo de red. */
const REINTENTO_MS = 1_500;

/** Sin SVG: servido desde nuestro origen, un SVG puede ejecutar scripts. */
const TIPOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Dominios desde los que Meta sirve los creativos. La URL llega dentro de un
 * payload externo: sin esta lista, la ingesta descargaría cualquier URL que
 * alguien le escriba, incluida la red interna del servidor (SSRF).
 */
const DOMINIOS_DE_META = [
  "fbcdn.net",
  "fbsbx.com",
  "facebook.com",
  "cdninstagram.com",
  "instagram.com",
];

function esDeMeta(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return DOMINIOS_DE_META.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * ¿Se puede descargar esta URL? Pura para poder probarla.
 *
 * `origenMock` es el origen del wa-mock y solo se pasa con los mocks
 * habilitados, que en producción no existen (`isMockEnabled` exige
 * `NODE_ENV !== "production"`).
 */
export function urlDeCreativoPermitida(
  raw: string,
  origenMock: string | null = null
): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (origenMock && u.origin === origenMock) return true;
  if (u.protocol !== "https:") return false;
  // Meta sirve sus CDN por el 443: un puerto explícito no es de Meta.
  if (u.port !== "") return false;
  return esDeMeta(u.hostname);
}

function origenDelMock(): string | null {
  if (!isMockEnabled()) return null;
  const base = process.env.META_GRAPH_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * Cómo acabó una descarga. `transitoria` vale la pena reintentarla (la red, un
 * 5xx, un 429, el tiempo); `permanente` no va a cambiar por insistir (host no
 * permitido, no es imagen, demasiado grande, 404).
 */
export type Descarga =
  | { ok: true; data: Buffer; mimeType: string }
  | { ok: false; falla: "transitoria" | "permanente" };

const PERMANENTE = { ok: false, falla: "permanente" } as const;
const TRANSITORIA = { ok: false, falla: "transitoria" } as const;

/** Suelta el cuerpo que no se va a leer: si no, la conexión queda ocupada. */
function descartar(res: Response): void {
  void res.body?.cancel().catch(() => {});
}

/**
 * Lee el cuerpo con tope: se corta en cuanto pasa de `max`, en vez de cargar en
 * memoria lo que un servidor quiera mandar sin `content-length`.
 */
async function leerConTope(
  res: Response,
  max: number
): Promise<Buffer | "grande" | "cortado"> {
  if (!res.body) return Buffer.alloc(0);
  const lector = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        void lector.cancel().catch(() => {});
        return "grande";
      }
      partes.push(value);
    }
  } catch {
    return "cortado"; // tiempo agotado o conexión caída a media lectura
  }
  return Buffer.concat(partes);
}

/**
 * Descarga acotada: cada salto de redirección se vuelve a validar, así que un
 * host de Meta no puede mandar la petición a otro sitio.
 */
export async function descargarCreativo(url: string): Promise<Descarga> {
  const origenMock = origenDelMock();
  const signal = AbortSignal.timeout(TIEMPO_MS);
  let actual = url;
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    if (!urlDeCreativoPermitida(actual, origenMock)) return PERMANENTE;
    let res: Response;
    try {
      res = await fetch(actual, {
        redirect: "manual",
        signal,
        cache: "no-store",
        headers: { accept: "image/*" },
      });
    } catch {
      return TRANSITORIA; // tiempo agotado o red caída
    }
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers.get("location");
      descartar(res);
      if (!destino) return PERMANENTE;
      try {
        actual = new URL(destino, actual).toString();
      } catch {
        return PERMANENTE;
      }
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      descartar(res);
      return TRANSITORIA;
    }
    if (!res.ok) {
      descartar(res);
      return PERMANENTE;
    }

    const mimeType =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const declarado = Number(res.headers.get("content-length") ?? "0");
    if (!TIPOS[mimeType] || declarado > CREATIVO_MAX_BYTES) {
      descartar(res);
      return PERMANENTE;
    }

    const data = await leerConTope(res, CREATIVO_MAX_BYTES);
    if (data === "cortado") return TRANSITORIA;
    if (data === "grande" || data.byteLength === 0) return PERMANENTE;
    return { ok: true, data, mimeType };
  }
  return PERMANENTE; // demasiadas redirecciones
}

/** Descarga con un reintento si el fallo fue transitorio. */
export async function descargarConReintento(
  url: string,
  esperaMs = REINTENTO_MS
): Promise<Descarga> {
  const primera = await descargarCreativo(url);
  if (primera.ok || primera.falla === "permanente") return primera;
  await new Promise((r) => setTimeout(r, esperaMs));
  return descargarCreativo(url);
}

/** La imagen ya guardada de este anuncio, si otra conversación la trajo. */
async function imagenExistente(
  organizationId: string,
  sourceId: string
): Promise<string | null> {
  const db = getDb();
  const filas = await db
    .select({ assetId: schema.mediaAsset.id })
    .from(schema.adAttribution)
    .innerJoin(
      schema.mediaAsset,
      eq(schema.mediaAsset.id, schema.adAttribution.imageAssetId)
    )
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.sourceId, sourceId),
        eq(schema.mediaAsset.organizationId, organizationId),
        eq(schema.mediaAsset.fetchStatus, "available")
      )
    )
    .limit(1);
  return filas[0]?.assetId ?? null;
}

/**
 * Deja la imagen en todas las conversaciones del anuncio que aún no la tienen:
 * la bajada que trajo la primera le sirve también a las que llegaron mientras
 * tanto.
 */
async function asignarImagen(
  organizationId: string,
  sourceId: string,
  assetId: string
): Promise<number> {
  const db = getDb();
  const filas = await db
    .update(schema.adAttribution)
    .set({ imageAssetId: assetId })
    .where(
      scoped(
        schema.adAttribution.organizationId,
        organizationId,
        eq(schema.adAttribution.sourceId, sourceId),
        isNull(schema.adAttribution.imageAssetId)
      )
    )
    .returning({ id: schema.adAttribution.id });
  return filas.length;
}

/**
 * Descargas en curso por anuncio. El caso normal las junta: entra el primer
 * mensaje, se lanza la copia, y el panel abierto pide el detalle en ese mismo
 * instante y lanzaría la reparación. Sin esto serían dos descargas y un
 * adjunto de más.
 */
const enCurso = new Set<string>();

/** ¿Hay ya una copia en marcha para este anuncio? */
export function descargaEnCurso(organizationId: string, sourceId: string): boolean {
  return enCurso.has(`${organizationId}:${sourceId}`);
}

export async function guardarCreativo(input: {
  organizationId: string;
  conversationId: string;
  sourceId: string;
  imageUrl: string;
}): Promise<string | null> {
  const { organizationId, sourceId } = input;
  // La tarjeta abierta se refresca con este evento: la imagen aparece sola.
  const avisar = () =>
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: input.conversationId } },
    });

  const existente = await imagenExistente(organizationId, sourceId);
  if (existente) {
    await asignarImagen(organizationId, sourceId, existente);
    avisar();
    return existente;
  }

  const clave = `${organizationId}:${sourceId}`;
  if (enCurso.has(clave)) return null;
  enCurso.add(clave);
  try {
    return await descargarYGuardar(input, avisar);
  } finally {
    enCurso.delete(clave);
  }
}

async function descargarYGuardar(
  input: { organizationId: string; sourceId: string; imageUrl: string },
  avisar: () => void
): Promise<string | null> {
  const { organizationId, sourceId } = input;

  const descarga = await descargarConReintento(input.imageUrl);
  if (!descarga.ok) {
    console.warn(
      `[atribucion] la imagen del anuncio ${sourceId} no se copió (${descarga.falla})`
    );
    return null;
  }

  const db = getDb();
  const assetId = newId("mediaAsset");
  const extension = TIPOS[descarga.mimeType] ?? "jpg";
  let guardado = false;
  try {
    await db.insert(schema.mediaAsset).values({
      id: assetId,
      organizationId,
      kind: "image",
      mimeType: descarga.mimeType,
      fileName: `anuncio-${sourceId.replace(/[^\w.-]/g, "_").slice(0, 64)}.${extension}`,
      payload: { origen: "anuncio", sourceId },
      fetchStatus: "pending",
    });
    const storagePath = await saveMediaFile(organizationId, assetId, descarga.data, descarga.mimeType);
    guardado = true;
    await db
      .update(schema.mediaAsset)
      .set({
        storagePath,
        fileSize: descarga.data.byteLength,
        fetchStatus: "available",
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaAsset.id, assetId));
    if ((await asignarImagen(organizationId, sourceId, assetId)) === 0) {
      // Otra descarga (otro proceso, o una que empezó antes) ya dejó su
      // imagen: esta copia sobra y no debe quedarse ocupando el volumen.
      await deleteMediaFile(organizationId, assetId).catch(() => {});
      await db.delete(schema.mediaAsset).where(eq(schema.mediaAsset.id, assetId));
      return imagenExistente(organizationId, sourceId);
    }
  } catch (err) {
    // Se quita lo que se alcanzó a crear; si ya estaba asignada, la clave
    // foránea deja esas filas sin imagen (`set null`), no apuntando a nada.
    if (guardado) await deleteMediaFile(organizationId, assetId).catch(() => {});
    await db
      .delete(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, assetId))
      .catch(() => {});
    console.warn(
      `[atribucion] no se pudo guardar la imagen del anuncio ${sourceId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }

  avisar();
  return assetId;
}
