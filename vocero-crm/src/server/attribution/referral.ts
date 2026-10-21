import type { WebhookReferral } from "@/server/inbox/webhook";

/**
 * 018 — Del `referral` de WhatsApp a UN anuncio de origen.
 *
 * Puro a propósito: se prueba sin base de datos, y es la única puerta por la
 * que un payload externo llega a una columna. Tiene que aguantar entradas
 * hostiles, no solo las bonitas de la documentación de Meta.
 *
 * Solo WhatsApp por ahora (spec 018, D3). Instagram y Messenger mandan otra
 * forma (`ad_id`, `ads_context_data`) y tendrán su propia función al lado de
 * esta, con la misma salida.
 */

export type AnuncioDeOrigen = {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  ctwaClid: string | null;
  /** De dónde bajar la imagen del creativo; se valida antes de usarla. */
  imageUrl: string | null;
  /** El referral recortado, para no perder campos que Meta añada después. */
  raw: Record<string, unknown>;
};

/**
 * Cotas de lo que se guarda. El payload de Meta es corto, pero nada impide que
 * un webhook traiga un titular de un megabyte, y no tiene por qué acabar en la
 * base.
 */
export const COTAS = {
  id: 128,
  titular: 300,
  texto: 2000,
  url: 2048,
  /** Tamaño máximo del `raw` serializado. */
  raw: 8_000,
} as const;

/** Claves de primer nivel que se conservan en `raw`. */
const CLAVES_WHATSAPP = [
  "source_url",
  "source_id",
  "source_type",
  "headline",
  "body",
  "media_type",
  "image_url",
  "video_url",
  "thumbnail_url",
  "ctwa_clid",
] as const;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Texto útil recortado, o null. Cualquier cosa que no sea texto no cuenta. */
function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.trim();
  if (!limpio) return null;
  return limpio.length > max ? limpio.slice(0, max) : limpio;
}

/**
 * Solo URLs http(s) completas: un `javascript:` jamás llega a un href. El http
 * pasa aquí porque el wa-mock sirve sus creativos así; la descarga y la tarjeta
 * vuelven a filtrar (https y hosts de Meta).
 */
function url(v: unknown): string | null {
  const t = texto(v, COTAS.url);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function recortarCampos(
  origen: Record<string, unknown>,
  claves: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of claves) {
    const v = texto(origen[k], k.endsWith("_url") ? COTAS.url : COTAS.texto);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Si aun recortado el `raw` excede la cota, se queda con lo que identifica al
 * anuncio. Con cotas por campo no debería pasar, pero la cota total es la que
 * se promete.
 */
function acotarRaw(raw: Record<string, unknown>, esencial: Record<string, unknown>) {
  return JSON.stringify(raw).length <= COTAS.raw ? raw : esencial;
}

/** WhatsApp Cloud API: `messages[].referral`. */
export function anuncioDeWhatsapp(referral: unknown): AnuncioDeOrigen | null {
  if (!esObjeto(referral)) return null;
  const r = referral as WebhookReferral & Record<string, unknown>;

  const sourceId = texto(r.source_id, COTAS.id);
  const ctwaClid = texto(r.ctwa_clid, COTAS.texto);
  const headline = texto(r.headline, COTAS.titular);
  const sourceUrl = url(r.source_url);
  // Sin nada que identifique el anuncio no hay nada que enseñar.
  if (!sourceId && !ctwaClid && !headline && !sourceUrl) return null;

  const raw = recortarCampos(r, CLAVES_WHATSAPP);
  return {
    sourceId,
    sourceType: texto(r.source_type, COTAS.id),
    sourceUrl,
    headline,
    body: texto(r.body, COTAS.texto),
    mediaType: texto(r.media_type, COTAS.id),
    ctwaClid,
    // La miniatura pesa menos; `image_url` es el creativo completo.
    imageUrl: url(r.thumbnail_url) ?? url(r.image_url),
    raw: acotarRaw(raw, { source_id: sourceId, headline }),
  };
}

/**
 * 018 (D2) — Sin la bandera `ATRIBUCION`, el anuncio se guarda sin su
 * identificador de clic: ni en la columna ni dentro del `raw`. Una instancia que
 * no atribuye no acumula identificadores de Meta "por si acaso" (016).
 */
export function sinIdentificadorDeClic(anuncio: AnuncioDeOrigen): AnuncioDeOrigen {
  const raw = { ...anuncio.raw };
  delete raw.ctwa_clid;
  return { ...anuncio, ctwaClid: null, raw };
}
