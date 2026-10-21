import { describe, expect, it, vi } from "vitest";
import { clasificarFallo, listModels, probeProvider } from "@/lib/ai/probe";

/**
 * #85 — «Probar conexión» y «Traer modelos» nunca lanzan: cada fallo vuelve
 * tipado y en el idioma del dueño, y la llave solo viaja en el header.
 */

function respuesta(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("probeProvider", () => {
  it("un turno mínimo con el modelo y la llave en Authorization → ok con latencia", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      respuesta(200, { choices: [{ message: { content: "ok" } }] })
    );
    const r = await probeProvider({
      baseUrl: "https://proveedor.test",
      model: "m/x",
      token: "sk-secreta",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://proveedor.test/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer sk-secreta",
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("m/x");
    expect(body.max_tokens).toBeLessThanOrEqual(5);
    expect(JSON.stringify(body)).not.toContain("sk-secreta");
  });

  it("clasifica los códigos del proveedor", () => {
    expect(clasificarFallo(401, "").code).toBe("invalid_token");
    expect(clasificarFallo(403, "").code).toBe("invalid_token");
    expect(clasificarFallo(402, "").code).toBe("no_credit");
    expect(clasificarFallo(404, "").code).toBe("model_not_found");
    expect(clasificarFallo(400, '{"error":{"message":"foo is not a valid model ID"}}').code).toBe(
      "model_not_found"
    );
    expect(clasificarFallo(400, "bad request").code).toBe("provider_error");
    expect(clasificarFallo(429, "").code).toBe("rate_limited");
    expect(clasificarFallo(500, "").code).toBe("provider_error");
  });

  it("incluye el error.message del proveedor en el mensaje", () => {
    const r = clasificarFallo(401, '{"error":{"message":"User not found."}}');
    expect(r.message).toContain("User not found.");
    expect(r.httpStatus).toBe(401);
  });

  it("200 sin choices → provider_error (no es una API de chat)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respuesta(200, { hola: "mundo" }));
    const r = await probeProvider({
      baseUrl: "https://proveedor.test",
      model: "m",
      token: "sk-x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("provider_error");
  });

  it("red caída → unreachable; URL inválida → bad_url sin tocar la red", async () => {
    const caida = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const r = await probeProvider({
      baseUrl: "https://proveedor.test",
      model: "m",
      token: "sk-x",
      fetchImpl: caida as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unreachable");

    const nunca = vi.fn();
    const mala = await probeProvider({
      baseUrl: "no es una url",
      model: "m",
      token: "sk-x",
      fetchImpl: nunca as unknown as typeof fetch,
    });
    expect(mala.ok).toBe(false);
    if (!mala.ok) expect(mala.code).toBe("bad_url");
    expect(nunca).not.toHaveBeenCalled();
  });
});

describe("listModels", () => {
  it("devuelve la lista ordenada con la forma de OpenRouter/OpenAI", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      respuesta(200, {
        data: [
          { id: "z/ultimo", name: "Último" },
          { id: "a/primero" },
          { id: "", name: "sin id" },
          null,
        ],
      })
    );
    const r = await listModels({
      baseUrl: "https://openrouter.ai/api",
      token: "sk-x",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.modelos).toEqual([
        { id: "a/primero", nombre: null },
        { id: "z/ultimo", nombre: "Último" },
      ]);
    }
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://openrouter.ai/api/v1/models");
  });

  it("404 o una respuesta que no es la lista → unsupported, sin romper", async () => {
    const r404 = await listModels({
      baseUrl: "https://proveedor.test",
      token: "sk-x",
      fetchImpl: vi.fn().mockResolvedValue(respuesta(404, "")) as unknown as typeof fetch,
    });
    expect(r404.ok).toBe(false);
    if (!r404.ok) expect(r404.code).toBe("unsupported");

    const rRara = await listModels({
      baseUrl: "https://proveedor.test",
      token: "sk-x",
      fetchImpl: vi.fn().mockResolvedValue(respuesta(200, { modelos: [] })) as unknown as typeof fetch,
    });
    expect(rRara.ok).toBe(false);
    if (!rRara.ok) expect(rRara.code).toBe("unsupported");
  });

  it("401 → invalid_token", async () => {
    const r = await listModels({
      baseUrl: "https://proveedor.test",
      token: "sk-x",
      fetchImpl: vi.fn().mockResolvedValue(respuesta(401, "")) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_token");
  });
});
