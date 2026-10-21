/**
 * Coincidencia de búsqueda tolerante, compartida por Bandeja y Contactos.
 *
 * Dos reglas nacidas de uso real:
 * 1. Sin acentos ni mayúsculas — "jose" encuentra a "José".
 * 2. El teléfono se compara por DÍGITOS: la UI lo pinta "+52 555 000 1234" y
 *    la BD lo guarda "525550001234", así que teclear el número tal como se ve
 *    (o pegarlo con espacios/guiones/paréntesis) no encontraba nada.
 */

const DIACRITICS = /[̀-ͯ]/g;

export function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(DIACRITICS, "");
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Mínimo de dígitos para tratar la consulta como teléfono: un "1" suelto
 * emparejaría con medio directorio.
 */
const MIN_PHONE_DIGITS = 3;

export function matchesQuery(
  query: string,
  fields: { text?: (string | null | undefined)[]; phone?: string | null }
): boolean {
  const q = normalizeText(query.trim());
  if (!q) return true;

  const inText = (fields.text ?? []).some(
    (value) => value != null && normalizeText(value).includes(q)
  );
  if (inText) return true;

  const queryDigits = digitsOnly(query);
  if (queryDigits.length < MIN_PHONE_DIGITS || !fields.phone) return false;
  return digitsOnly(fields.phone).includes(queryDigits);
}
