import type { SourceDto, SourceValue } from "@/lib/types";

/**
 * Fuente del prospecto.
 *
 * Lo que el dueño captura MANDA; lo que no, se marca como deducido. Por eso
 * `contact.source` nace NULL: nadie tiene que capturar a mano la fuente de los
 * cientos de contactos que ya existían, ni marcarlos en falso con un backfill.
 * La UI distingue las dos cosas para no presentar una suposición como un dato.
 */

export const SOURCE_VALUES: readonly SourceValue[] = [
  "anuncio",
  "organico",
  "referido",
  "conocido",
  "otro",
];

export const SOURCE_LABELS: Record<SourceValue | "desconocida", string> = {
  anuncio: "Anuncio",
  organico: "Contenido orgánico",
  referido: "Referido",
  conocido: "Conocido",
  otro: "Otro",
  desconocida: "Sin identificar",
};

export function isSourceValue(v: unknown): v is SourceValue {
  return typeof v === "string" && SOURCE_VALUES.includes(v as SourceValue);
}

/**
 * Un contacto que llegó solo por WhatsApp no dice de dónde salió, y el CRM no
 * lo inventa: queda "sin identificar" hasta que alguien lo capture.
 *
 * 018 — Salvo que Meta lo haya dicho: si la conversación la abrió un anuncio,
 * la fuente se DEDUCE "anuncio". Lo capturado a mano sigue mandando.
 */
export function effectiveSource(
  stored: SourceValue | null,
  llegoPorAnuncio = false
): SourceDto {
  if (stored) return { value: stored, source: "capturada" };
  if (llegoPorAnuncio) return { value: "anuncio", source: "deducida" };
  return { value: "desconocida", source: "deducida" };
}
