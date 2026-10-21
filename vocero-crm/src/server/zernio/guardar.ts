import { apiError } from "@/lib/api";
import { MetaApiError } from "@/lib/meta/client";
import {
  fetchZernioAccounts,
  pickZernioAccount,
  type ZernioAccount,
  type ZernioChannel,
} from "@/server/zernio/cuentas";

/**
 * 023 — El paso que comparten las tres pantallas al guardar una conexión por
 * Zernio: comprobar la llave y decidir de qué cuenta se trata (D1 de la spec).
 *
 * Una sola lectura de `GET /accounts` hace las dos cosas: una llave que no
 * sirve responde 401, y la lista dice qué cuenta es la del canal. Devuelve la
 * respuesta de error ya armada para que las tres rutas contesten igual.
 */
export async function resolveZernioAccount(
  token: string,
  accountRef: string | null | undefined,
  channel: ZernioChannel
): Promise<{ ok: true; account: ZernioAccount } | { ok: false; response: Response }> {
  let accounts: ZernioAccount[];
  try {
    accounts = await fetchZernioAccounts(token);
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    // Sin respuesta, 5xx o límite de peticiones: no dice nada de la llave.
    if (err.status === 0 || err.status >= 500 || err.status === 429) {
      return {
        ok: false,
        response: apiError(
          503,
          "platform_unavailable",
          "No se pudo contactar a Zernio; intenta de nuevo"
        ),
      };
    }
    return {
      ok: false,
      response: apiError(422, "invalid_token", "La API key de Zernio no es válida"),
    };
  }

  const pick = pickZernioAccount(accounts, accountRef, channel);
  if (pick.ok) return { ok: true, account: pick.account };
  return {
    ok: false,
    response: Response.json(
      {
        error: {
          code: pick.code,
          message: pick.message,
          // Solo id y nombre: es lo que la pantalla necesita para ofrecerlas.
          details: { accounts: pick.candidates },
        },
      },
      { status: 422 }
    ),
  };
}
