import { apiRoot } from "@/lib/ai/presets";
import { resolveAiProvider } from "@/lib/ai/provider";
import { marcarEstadoPorRespuesta } from "@/server/ai/credentials";

/**
 * 036 — El CRM piensa por el cerebro (`POST /api/bot/llm/{ruta}`).
 *
 * Puerto de `/api/brains/llm` de la edición cloud. La llave de IA se pone una
 * vez, en Ajustes → IA, y no sale del CRM: el cerebro (Nea) apunta el
 * `base_url` de su SDK de OpenAI aquí y el CRM le pone la llave al reenviar.
 * Así quien instala no la copia a dos lugares, una filtrada no viaja, y
 * cuando el proveedor la rechaza (401, o 402 sin saldo) es el CRM quien se
 * entera y la pausa en la pantalla, igual que con el agente que traía.
 *
 * No interpreta el cuerpo: se reenvía como llegó. Entenderlo convertiría al
 * CRM en un mini-OpenRouter que hay que actualizar cada vez que un proveedor
 * agrega un campo.
 *
 * Sin lista de modelos permitidos, a diferencia de cloud (spec 036, D4): allá
 * el cerebro puede ser de un tercero; aquí lo pone quien instala y entra con
 * la misma `BOT_API_KEY` que ya escribe en la bandeja. El perfil le dice qué
 * modelo eligió el negocio (`llm.model`).
 */

/** Cuánto se espera a que el proveedor piense antes de rendirse. */
export const LLM_PROXY_TIMEOUT_MS = 120_000;

export type ResultadoProxy =
  | { ok: true; status: number; cuerpo: string; contentType: string }
  | { ok: false; status: number; code: string; message: string };

export async function pensarPorElCerebro(input: {
  organizationId: string;
  /** Lo que viene después de `/api/bot/llm/`: `chat/completions` hoy. */
  ruta: string;
  cuerpoCrudo: string;
  contentType: string | null;
}): Promise<ResultadoProxy> {
  const r = await resolveAiProvider(input.organizationId);
  if (!r.ok) {
    return {
      ok: false,
      status: 402,
      code: "sin_credencial",
      message:
        r.estado.motivo === "sin_configurar"
          ? "No hay proveedor de IA configurado. Ponlo en Ajustes → IA."
          : "La llave de IA está pausada (el proveedor la rechazó). Revísala en Ajustes → IA.",
    };
  }
  const { provider } = r;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiRoot(provider.baseUrl)}/${input.ruta}`, {
      method: "POST",
      headers: {
        // La llave se pone AQUÍ y solo aquí: no se loguea ni vuelve al cerebro.
        Authorization: `Bearer ${provider.token}`,
        "Content-Type": input.contentType ?? "application/json",
      },
      body: input.cuerpoCrudo,
      signal: controller.signal,
    });
    const cuerpo = await res.text();

    // El estado de la credencial lo dicta quien cobra. El respaldo del
    // entorno no tiene fila que pausar. `.catch`: un fallo al escribir el
    // estado no convierte la respuesta del proveedor en un error.
    if (!res.ok && provider.source === "org") {
      await marcarEstadoPorRespuesta(input.organizationId, res.status, cuerpo.slice(0, 200)).catch(
        () => {}
      );
    }

    return {
      ok: true,
      status: res.status,
      cuerpo,
      contentType: res.headers.get("content-type") ?? "application/json",
    };
  } catch (err) {
    // Timeout o red: no fue el proveedor quien rechazó la llave, no se pausa.
    return {
      ok: false,
      status: 504,
      code: "proveedor_sin_respuesta",
      message: err instanceof Error && err.name === "AbortError" ? "El proveedor no contestó a tiempo" : "No se pudo hablar con el proveedor",
    };
  } finally {
    clearTimeout(timer);
  }
}
