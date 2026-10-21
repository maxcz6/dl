import { JUDGE_MARKER } from "@/server/ai/prompts";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

/**
 * Sufijos de la llave que el mock rechaza, con el código que daría el
 * proveedor real: `-invalid` → 401 (llave rechazada) y `-sin-saldo` → 402.
 * Es lo que permite ejercitar la pausa de Ajustes → IA en el self-test sin
 * un proveedor de verdad. Cualquier otra llave se acepta.
 */
export function aiMockAuthFailure(
  authorization: string | null
): { status: 401 | 402; body: { error: { message: string } } } | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.endsWith("-invalid")) {
    return { status: 401, body: { error: { message: "Invalid API key (mock)" } } };
  }
  if (token.endsWith("-sin-saldo")) {
    return {
      status: 402,
      body: { error: { message: "Insufficient credits (mock)" } },
    };
  }
  return null;
}

/** La lista de `GET /v1/models` del mock: suficiente para «Traer modelos». */
export function aiMockModels(): { id: string; name: string }[] {
  return [
    { id: "mock/agente", name: "Modelo de prueba (agente)" },
    { id: "mock/juez", name: "Modelo de prueba (juez)" },
  ];
}

/**
 * 025 — Lo que el guion necesita para probar el turno del agente incluido.
 *
 * `demoraMs` hace que el modelo «piense»: es lo que deja meter un mensaje con
 * el turno en curso. Y se guarda lo que se le preguntó, porque la respuesta
 * sola no dice en qué ORDEN leyó la conversación — y ese orden es justo lo que
 * decide si atiende el mensaje que entró mientras pensaba.
 */
type Peticion = { at: string; mensajes: InMessage[] };
type EstadoIa = { demoraMs: number; peticiones: Peticion[] };

const globalForIa = globalThis as unknown as { __voceroAiMock?: EstadoIa };

function estadoIa(): EstadoIa {
  globalForIa.__voceroAiMock ??= { demoraMs: 0, peticiones: [] };
  return globalForIa.__voceroAiMock;
}

/** Consulta o configura el mock: `?demoraMs=3000`, `?reset=1`. */
export function aiMockEstado(params: URLSearchParams): EstadoIa {
  const e = estadoIa();
  const demoraMs = params.get("demoraMs");
  if (demoraMs !== null) {
    e.demoraMs = Math.min(Math.max(Number(demoraMs) || 0, 0), 60_000);
  }
  if (params.get("reset") === "1") e.peticiones = [];
  return e;
}

/**
 * Anota la petición y espera lo configurado. El juez del Laboratorio no se
 * anota ni se demora: lo que se observa es la charla con el cliente.
 */
export async function aiMockRegistrar(messages: InMessage[]): Promise<void> {
  if (messages.some((m) => m.role === "system" && m.content.includes(JUDGE_MARKER))) {
    return;
  }
  const e = estadoIa();
  // Sin el prompt de sistema: es largo, y lo que se comprueba es la charla.
  e.peticiones.push({
    at: new Date().toISOString(),
    mensajes: messages.filter((m) => m.role !== "system"),
  });
  if (e.peticiones.length > 50) e.peticiones.shift();
  if (e.demoraMs > 0) await new Promise((r) => setTimeout(r, e.demoraMs));
}

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  // 036 — Lo demás es un cerebro pensando por `/api/bot/llm`: texto de eco,
  // determinista. El agente que contestaba con acciones JSON ya no existe.
  return `Respuesta de prueba sobre: ${lastUser.slice(0, 80)}`;
}
