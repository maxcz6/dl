import openapi from "../../../../../docs/openapi.json";

export const dynamic = "force-static";

/**
 * 035 — El contrato del cerebro, servido por la instancia. Sin llave: es
 * documentación y no lleva secretos. El archivo es `docs/openapi.json` (se
 * importa para que viaje dentro del build: la imagen no copia `docs/`) y
 * `tests/unit/openapi.test.ts` lo valida contra las rutas.
 */
export function GET(): Response {
  return Response.json(openapi);
}
