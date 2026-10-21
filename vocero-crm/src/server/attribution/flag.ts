/**
 * 016 — Si esta instancia atribuye anuncios y le reporta conversiones a Meta.
 *
 * Mismo trato que los canales opcionales (ADR-001) y la agenda (ADR-002): el
 * código viaja siempre en `main` y lo que decide si EXISTE para el usuario es
 * una variable de despliegue. Una instancia que no anuncia no ve esto por
 * ningún lado: ni pestaña de Ajustes, ni rutas, ni una credencial que pedir.
 *
 * Qué apaga la bandera y qué no (decisión del dueño, 2026-09-21, spec 018):
 *
 * - NO apaga el ORIGEN del anuncio. Que una conversación llegó del anuncio A,
 *   con su titular y su creativo, se guarda y se ve siempre en la bandeja: el
 *   dato viaja dentro del webhook que la instancia ya recibe, no pide
 *   credenciales ni llama a nadie, y es inerte si nunca llega un anuncio.
 * - SÍ apaga el `ctwa_clid`, además del envío a Meta y la pestaña de Ajustes.
 *   El identificador de clic llega gratis en el webhook y guardarlo "por si
 *   acaso" haría que encender la bandera meses después tuviera historia que
 *   reportar — pero llenar una tabla con identificadores de clic de Meta en
 *   una instancia que nunca pidió esa función rompe la promesa de ADR-001 por
 *   el lado que más importa, el de los datos. Sin la bandera el anuncio se
 *   guarda sin él, ni en su columna ni dentro del `raw`. El costo (encender
 *   atribuye de ahí en adelante) es menor de lo que parece: la ventana de
 *   atribución de Meta se mide en días, no en meses.
 *
 * La migración se aplica siempre: unas tablas vacías son inertes, y a cambio
 * todas las instancias comparten la misma estructura.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseAtribucionFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/**
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `agendaEnabled()` e `isMockEnabled()`: preguntar si una feature existe no
 * puede depender de que TODO el entorno valide. La ingesta de un mensaje
 * consulta esta bandera (para decidir si guarda el `ctwa_clid`), y un entorno
 * a medio configurar debe degradar —no reventar— justo ahí.
 *
 * `ATRIBUCION` sí está declarada en el esquema de `lib/env.ts`: ahí viven su
 * documentación y su tipo. Lo que no pasa por el validador es esta consulta.
 */
export function atribucionEnabled(): boolean {
  return parseAtribucionFlag(process.env.ATRIBUCION);
}

/**
 * Respuesta para una superficie apagada. 404 y no 403 a propósito: si la
 * bandera está apagada, ese endpoint no existe en esta instancia — no hay nada
 * que revelar sobre él.
 */
export function atribucionDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
