/**
 * 018 — Cómo se nombra el origen en pantalla. Sin dependencias de servidor: lo
 * usan la lista, el panel, el cajón del trato y la fuente del contacto.
 *
 * Meta marca `source_type: "post"` cuando el clic vino de una publicación y no
 * de un anuncio. Llamarlo "anuncio" haría pasar por pagado algo que no lo fue.
 */
export function etiquetaDeOrigen(sourceType: string | null | undefined): string {
  return sourceType === "post" ? "Publicación" : "Anuncio";
}

/**
 * ¿Cuenta como fuente "anuncio"? Una publicación se enseña en la bandeja igual,
 * pero no se suma a los anuncios en la fuente del prospecto.
 */
export function cuentaComoAnuncio(
  anuncio: { sourceType: string | null } | null | undefined
): boolean {
  return !!anuncio && anuncio.sourceType !== "post";
}

/** Titular a enseñar cuando Meta no mandó ninguno. */
export function titularDeOrigen(
  headline: string | null | undefined,
  sourceType: string | null | undefined
): string {
  if (headline) return headline;
  return sourceType === "post" ? "Publicación sin título" : "Anuncio sin título";
}
