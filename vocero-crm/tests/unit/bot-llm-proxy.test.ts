import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiResolution } from "@/lib/ai/provider";

/**
 * 036 — `POST /api/bot/llm/{ruta}`: el CRM piensa por el cerebro con la llave
 * de Ajustes → IA. Lo que se protege: que solo entre quien trae `BOT_API_KEY`
 * (también como Bearer, que es lo que manda el SDK), que el cuerpo y la
 * respuesta viajen tal cual, que el 401/402 del proveedor pause la llave del
 * negocio, y que la llave de IA no vuelva nunca al cerebro.
 */

const LLAVE_BOT = "b".repeat(32);
const LLAVE_IA = "sk-or-secreta-9f3a";

const resolveAiProvider = vi.hoisted(() => vi.fn<() => Promise<AiResolution>>());
vi.mock("@/lib/ai/provider", () => ({ resolveAiProvider }));
const marcarEstadoPorRespuesta = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/server/ai/credentials", () => ({ marcarEstadoPorRespuesta }));
vi.mock("@/server/bot/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/bot/auth")>()),
  resolveInstanceOrg: async () => "org_1",
}));

import { POST } from "@/app/api/bot/llm/[...ruta]/route";
import { resetRateLimit } from "@/lib/rate-limit";

const PROVEEDOR = (source: "org" | "env" = "org"): AiResolution => ({
  ok: true,
  provider: { source, baseUrl: "https://proveedor.test/api", model: "m/uno", judgeModel: "m/uno", token: LLAVE_IA },
});

const CUERPO = JSON.stringify({ model: "m/uno", messages: [{ role: "user", content: "hola" }], extra: { x: 1 } });

function peticion(headers: Record<string, string>, ruta = ["chat", "completions"]) {
  return POST(
    new Request("http://crm.test/api/bot/llm/" + ruta.join("/"), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: CUERPO,
    }),
    { params: Promise.resolve({ ruta }) }
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("BOT_API_KEY", LLAVE_BOT);
  resetRateLimit();
  resolveAiProvider.mockReset().mockResolvedValue(PROVEEDOR());
  marcarEstadoPorRespuesta.mockClear();
  // Una respuesta nueva por llamada: un cuerpo solo se lee una vez.
  fetchMock.mockReset().mockImplementation(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "hola!" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/bot/llm — quién entra", () => {
  it("sin llave → 401 y no llama al proveedor", async () => {
    const res = await peticion({});
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con una llave equivocada → 401", async () => {
    expect((await peticion({ authorization: "Bearer " + "x".repeat(32) })).status).toBe(401);
  });

  it("entra con Bearer (el SDK de OpenAI) y con X-API-Key", async () => {
    expect((await peticion({ authorization: `Bearer ${LLAVE_BOT}` })).status).toBe(200);
    expect((await peticion({ "x-api-key": LLAVE_BOT })).status).toBe(200);
  });
});

describe("/api/bot/llm — el reenvío", () => {
  it("reenvía el cuerpo TAL CUAL a {base}/v1/{ruta} con la llave del negocio, y devuelve la respuesta tal cual", async () => {
    const res = await peticion({ authorization: `Bearer ${LLAVE_BOT}` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proveedor.test/api/v1/chat/completions");
    expect(init.body).toBe(CUERPO);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${LLAVE_IA}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ choices: [{ message: { content: "hola!" } }] });
  });

  it("el código del proveedor pasa tal cual (429)", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"lento"}', { status: 429 }));
    const res = await peticion({ authorization: `Bearer ${LLAVE_BOT}` });
    expect(res.status).toBe(429);
    expect(marcarEstadoPorRespuesta).toHaveBeenCalledWith("org_1", 429, '{"error":"lento"}');
  });

  it("un 401 del proveedor llega a la función que pausa la llave del negocio", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"bad key"}', { status: 401 }));
    const res = await peticion({ authorization: `Bearer ${LLAVE_BOT}` });
    expect(res.status).toBe(401);
    expect(marcarEstadoPorRespuesta).toHaveBeenCalledWith("org_1", 401, '{"error":"bad key"}');
  });

  it("con el respaldo del entorno no hay fila que pausar", async () => {
    resolveAiProvider.mockResolvedValue(PROVEEDOR("env"));
    fetchMock.mockResolvedValue(new Response("{}", { status: 402 }));
    expect((await peticion({ authorization: `Bearer ${LLAVE_BOT}` })).status).toBe(402);
    expect(marcarEstadoPorRespuesta).not.toHaveBeenCalled();
  });

  it("sin IA configurada → 402 sin_credencial, sin llamar al proveedor", async () => {
    resolveAiProvider.mockResolvedValue({ ok: false, estado: { activa: false, motivo: "sin_configurar" } });
    const res = await peticion({ authorization: `Bearer ${LLAVE_BOT}` });
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("sin_credencial");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("con la llave pausada → 402 sin_credencial que dice que está pausada", async () => {
    resolveAiProvider.mockResolvedValue({
      ok: false,
      estado: { activa: false, motivo: "sin_saldo", last4: "9f3a", desde: null },
    });
    const res = await peticion({ authorization: `Bearer ${LLAVE_BOT}` });
    expect(res.status).toBe(402);
    expect((await res.json()).error.message).toMatch(/pausada/);
  });

  it("si el proveedor no contesta → 504 proveedor_sin_respuesta y NO pausa", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await peticion({ authorization: `Bearer ${LLAVE_BOT}` });
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("proveedor_sin_respuesta");
    expect(marcarEstadoPorRespuesta).not.toHaveBeenCalled();
  });

  it("la llave de IA no aparece en ninguna respuesta, ni en los errores", async () => {
    const vistas: string[] = [];
    vistas.push(await (await peticion({ authorization: `Bearer ${LLAVE_BOT}` })).text());
    fetchMock.mockRejectedValue(new Error(`boom ${LLAVE_IA}`));
    vistas.push(await (await peticion({ authorization: `Bearer ${LLAVE_BOT}` })).text());
    for (const v of vistas) expect(v).not.toContain(LLAVE_IA);
  });
});
