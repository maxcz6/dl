import { apiError, withAuth } from "@/lib/api";
import {
  FAVICON_ASSET,
  MAX_FAVICON_BYTES,
  sniffFaviconMime,
} from "@/lib/favicon";
import { getBranding, saveBranding } from "@/server/branding";
import { deleteMediaFile, saveMediaFile } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

/**
 * Subir el icono de la pestaña. El cuerpo va crudo con su `content-type`, sin
 * multipart: es un archivo suelto y montar un parser de formulario para eso
 * es trabajo que no compra nada.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }

  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) {
    return apiError(422, "empty", "No llegó ningún archivo");
  }
  if (buf.byteLength > MAX_FAVICON_BYTES) {
    return apiError(
      413,
      "too_large",
      `El icono no puede pasar de ${Math.round(MAX_FAVICON_BYTES / 1024)} KB`
    );
  }

  // El tipo sale de los BYTES, no de lo que declare el cliente: decir
  // `image/png` y mandar un HTML es la forma clásica de colar un documento
  // donde se espera una imagen, y esto se sirve desde el mismo dominio.
  const mime = sniffFaviconMime(buf);
  if (!mime) {
    return apiError(
      422,
      "unsupported",
      "Formato no reconocido. Usa PNG, SVG, ICO, JPEG o WebP."
    );
  }

  await saveMediaFile(session.organizationId, FAVICON_ASSET, buf, mime);

  const branding = await getBranding(session.organizationId);
  // Marca de tiempo y no un contador: al quitar el icono no queda dónde
  // recordar por cuál íbamos, así que un contador reiniciaría en 1 y la URL
  // `?v=u1` sería la MISMA que la del logo anterior — el navegador seguiría
  // enseñando el viejo, que es justo lo que este número existe para evitar.
  const version = Date.now();
  await saveBranding(session.organizationId, {
    ...branding,
    favicon: { mime, version },
  });

  return Response.json({ favicon: { mime, version } });
});

/** Quitar el subido y volver al generado de la marca. */
export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }

  const branding = await getBranding(session.organizationId);
  await saveBranding(session.organizationId, { ...branding, favicon: null });
  // El archivo se borra DESPUÉS de que la marca ya no lo referencia: si esto
  // falla, queda un archivo huérfano —inofensivo— en vez de una marca
  // apuntando a algo que ya no está.
  await deleteMediaFile(session.organizationId, FAVICON_ASSET).catch(() => null);

  return Response.json({ favicon: null });
});
