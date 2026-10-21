/**
 * #78 — Con qué cabeceras se sirve un adjunto al navegador
 * (`GET /api/media/{assetId}`).
 *
 * Un adjunto es un archivo que mandó un cliente: contenido que no controlamos,
 * servido desde el mismo origen que la sesión del operador. Si el navegador lo
 * abriera como página —un `.html` que dice ser documento, un SVG con un
 * `<script>`, o un tipo adivinado a partir de los bytes— correría con las
 * cookies del CRM. Tres cabeceras cierran esa clase de problema entera, con el
 * mismo patrón que ya usa el icono de la marca
 * (`src/app/api/branding/favicon/route.ts`):
 *
 * - `X-Content-Type-Options: nosniff`: el navegador se cree el tipo declarado
 *   y no lo reinterpreta por el contenido.
 * - `Content-Security-Policy: default-src 'none'; sandbox`: aunque el tipo
 *   resultara ser un documento, no tiene de dónde cargar nada ni permiso para
 *   ejecutar guiones, enviar formularios ni abrir ventanas.
 * - `Content-Disposition`: `inline` solo para lo que el navegador previsualiza
 *   de forma inerte (imagen, audio, video, PDF); todo lo demás se descarga.
 *
 * Módulo puro (sin BD ni disco) para poder probarse por unidad; la ruta solo
 * lee el asset y llama aquí.
 */

/**
 * Lo que el navegador muestra sin ejecutar nada. Lista cerrada: lo que no está
 * aquí se descarga, aunque sea inofensivo (un `.txt`, un `.csv`).
 */
export const PREVIEWABLE_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
  "video/mp4",
  "video/3gpp",
  "application/pdf",
]);

/**
 * Tipos que un navegador abre como DOCUMENTO con permiso de ejecutar guiones.
 * No se aceptan como adjunto saliente: WhatsApp no los previsualiza y no hay
 * caso de negocio que justifique colar una página en el origen del CRM.
 */
export const FORBIDDEN_UPLOAD_MIMES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
]);

/** `tipo/subtipo`, con o sin parámetros (`; codecs=opus`), solo ASCII imprimible. */
const MIME_SHAPE = /^[\w.+-]+\/[\w.+-]+(\s*;[\x20-\x7e]*)?$/;
const MIME_BASE_SHAPE = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * `Audio/OGG; codecs=opus` → `audio/ogg`. Meta manda los audios con el códec
 * como parámetro; previsualizar o no se decide por el tipo base.
 */
export function baseMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase();
  return MIME_BASE_SHAPE.test(base) ? base : null;
}

export function isPreviewable(mime: string | null | undefined): boolean {
  const base = baseMime(mime);
  return base !== null && PREVIEWABLE_MIMES.has(base);
}

export function isForbiddenUploadMime(mime: string | null | undefined): boolean {
  const base = baseMime(mime);
  return base !== null && FORBIDDEN_UPLOAD_MIMES.has(base);
}

/**
 * El `Content-Type` que se declara. Un MIME ausente o malformado (un asset
 * viejo sin tipo, basura en la metadata de Meta) sale como
 * `application/octet-stream`, que junto con `nosniff` significa «descárgalo y
 * no lo interpretes».
 */
export function contentTypeFor(mime: string | null | undefined): string {
  const limpio = (mime ?? "").trim();
  return MIME_SHAPE.test(limpio) ? limpio.toLowerCase() : "application/octet-stream";
}

/**
 * Nombre de archivo apto para la cabecera: sin comillas, saltos de línea ni
 * rutas. El `filename*` conserva acentos y eñes (RFC 5987) para que
 * «cotización.pdf» se descargue con su nombre; el `filename` plano es el
 * respaldo ASCII.
 */
export function contentDisposition(
  tipo: "inline" | "attachment",
  fileName: string | null | undefined
): string {
  const nombre = (fileName ?? "")
    .replace(/[\/\r\n\t"]/g, "_")
    .trim()
    .slice(0, 150);
  if (!nombre) return tipo;
  const ascii = nombre.replace(/[^\w. -]/g, "_");
  const utf8 = encodeURIComponent(nombre).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Cabeceras completas con las que se sirve el binario de un adjunto. */
export function mediaResponseHeaders(
  asset: { mimeType: string | null; fileName: string | null },
  byteLength: number
): Record<string, string> {
  const inline = isPreviewable(asset.mimeType);
  return {
    "content-type": contentTypeFor(asset.mimeType),
    "content-length": String(byteLength),
    "content-disposition": contentDisposition(
      inline ? "inline" : "attachment",
      asset.fileName
    ),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    // El contenido de un asset es inmutable; privado por sesión.
    "cache-control": "private, max-age=86400",
  };
}
