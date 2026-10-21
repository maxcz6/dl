/**
 * Dinero. Vive en `lib/` (no en `server/`) porque el tablero suma sus columnas
 * en el cliente y no puede arrastrar la BD al bundle.
 *
 * Todo en CENTAVOS ENTEROS, también en el cálculo: sumar pesos en coma flotante
 * da totales que el dueño no puede cuadrar contra sus propias tarjetas.
 *
 * La moneda NO está cableada. Cada instancia elige la suya en Ajustes → Marca,
 * y todas las funciones la reciben explícitamente: un default global escondido
 * haría que una instalación fuera de su país sumara mal sin avisar.
 */

/**
 * Monedas ISO-4217 que puede elegir un negocio, agrupadas para el selector.
 *
 * Cubre México, Centro y Sudamérica, el Caribe hispano, EE. UU. y España, y
 * los países que los rodean, para que una instalación en otro país no tenga
 * que esperar a que alguien añada su moneda. Los países dolarizados (Ecuador,
 * El Salvador, Puerto Rico) usan USD, y Panamá puede elegir USD o balboa.
 * Añadir una es añadir un renglón: nada en la BD restringe el código.
 */
export const CURRENCY_OPTIONS = [
  { code: "MXN", name: "Peso mexicano", where: "México", group: "latam" },
  { code: "GTQ", name: "Quetzal", where: "Guatemala", group: "latam" },
  { code: "HNL", name: "Lempira", where: "Honduras", group: "latam" },
  { code: "NIO", name: "Córdoba", where: "Nicaragua", group: "latam" },
  { code: "CRC", name: "Colón costarricense", where: "Costa Rica", group: "latam" },
  { code: "PAB", name: "Balboa", where: "Panamá", group: "latam" },
  { code: "BZD", name: "Dólar beliceño", where: "Belice", group: "latam" },
  { code: "DOP", name: "Peso dominicano", where: "República Dominicana", group: "latam" },
  { code: "CUP", name: "Peso cubano", where: "Cuba", group: "latam" },
  { code: "HTG", name: "Gourde", where: "Haití", group: "latam" },
  { code: "JMD", name: "Dólar jamaiquino", where: "Jamaica", group: "latam" },
  { code: "TTD", name: "Dólar de Trinidad y Tobago", where: "Trinidad y Tobago", group: "latam" },
  { code: "COP", name: "Peso colombiano", where: "Colombia", group: "latam" },
  { code: "VES", name: "Bolívar", where: "Venezuela", group: "latam" },
  { code: "PEN", name: "Sol", where: "Perú", group: "latam" },
  { code: "BOB", name: "Boliviano", where: "Bolivia", group: "latam" },
  { code: "CLP", name: "Peso chileno", where: "Chile", group: "latam" },
  { code: "ARS", name: "Peso argentino", where: "Argentina", group: "latam" },
  { code: "UYU", name: "Peso uruguayo", where: "Uruguay", group: "latam" },
  { code: "PYG", name: "Guaraní", where: "Paraguay", group: "latam" },
  { code: "BRL", name: "Real", where: "Brasil", group: "latam" },
  { code: "USD", name: "Dólar estadounidense", where: "EE. UU., Ecuador, El Salvador, Puerto Rico, Panamá", group: "norte" },
  { code: "CAD", name: "Dólar canadiense", where: "Canadá", group: "norte" },
  { code: "EUR", name: "Euro", where: "España y zona euro", group: "europa" },
  { code: "GBP", name: "Libra esterlina", where: "Reino Unido", group: "europa" },
  { code: "CHF", name: "Franco suizo", where: "Suiza", group: "europa" },
  { code: "XAF", name: "Franco CFA", where: "Guinea Ecuatorial", group: "otras" },
  { code: "AUD", name: "Dólar australiano", where: "Australia", group: "otras" },
  { code: "JPY", name: "Yen", where: "Japón", group: "otras" },
] as const;

export const CURRENCY_GROUPS = [
  { id: "latam", label: "Latinoamérica y el Caribe" },
  { id: "norte", label: "Norteamérica" },
  { id: "europa", label: "Europa" },
  { id: "otras", label: "Otras" },
] as const;

export type Currency = (typeof CURRENCY_OPTIONS)[number]["code"];

export const CURRENCIES = CURRENCY_OPTIONS.map((c) => c.code) as [
  Currency,
  ...Currency[],
];

export const DEFAULT_CURRENCY: Currency = "MXN";

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
}

/**
 * ¿Este monto entra en el total de su columna? Solo suma lo que está en la
 * moneda del negocio: convertir exigiría un tipo de cambio, y un CRM que
 * inventa tipos de cambio miente. Lo que queda fuera se CUENTA aparte para
 * poder decirlo en pantalla, en vez de desaparecerlo.
 */
export function sumable(
  amount: { amountCents: number | null; currency: string | null },
  businessCurrency: string
): boolean {
  if (amount.amountCents === null) return false;
  return (amount.currency ?? businessCurrency) === businessCurrency;
}

/** Dinero para mostrar. Recibe centavos porque es como viaja y como se guarda. */
export function formatMoneyCents(
  cents: number | null | undefined,
  currency: string,
  locale = "es-MX"
): string | null {
  if (cents === null || cents === undefined) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Moneda o locale que el runtime no conoce: mejor un número correcto sin
    // símbolo que una pantalla rota.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Texto libre del dueño → centavos. Acepta "12,500.50", "12500", "$12 500".
 * Devuelve `null` si no hay un número reconocible, para no guardar un 0 que
 * después se lea como "no vale nada".
 */
export function parseMoneyToCents(input: string): number | null {
  const limpio = input.replace(/[^\d.,-]/g, "").trim();
  if (!limpio) return null;
  // El último separador manda como decimal; el resto son de millares.
  const ultimoPunto = limpio.lastIndexOf(".");
  const ultimaComa = limpio.lastIndexOf(",");
  const corte = Math.max(ultimoPunto, ultimaComa);
  let entero = limpio;
  let decimales = "";
  if (corte !== -1 && limpio.length - corte <= 3) {
    entero = limpio.slice(0, corte);
    decimales = limpio.slice(corte + 1);
  }
  const soloDigitos = entero.replace(/[^\d-]/g, "");
  if (!soloDigitos || soloDigitos === "-") return null;
  const cents =
    Number(soloDigitos) * 100 + Number((decimales + "00").slice(0, 2)) *
      (soloDigitos.startsWith("-") ? -1 : 1);
  return Number.isFinite(cents) ? Math.trunc(cents) : null;
}
