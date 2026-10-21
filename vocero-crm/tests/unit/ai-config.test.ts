import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  apiRoot,
  chatCompletionsUrl,
  last4,
  modelsUrl,
  OPENROUTER_BASE_URL,
  presetDeBaseUrl,
} from "@/lib/ai/presets";
import {
  envAiProvider,
  interpretarCredencial,
  mensajeDeEstado,
  resolver,
  type AiProvider,
} from "@/lib/ai/provider";
import { estadoSegunRespuesta } from "@/server/ai/credentials";
import {
  aiModelsSchema,
  aiProbeSchema,
  aiSettingsPutSchema,
  baseUrlEfectiva,
} from "@/server/ai/settings";
import type { AiCredentialSecret } from "@/server/ai/credentials";

/**
 * #85 — Ajustes → IA. Las reglas puras: con quién habla el adaptador (la fila
 * manda, el entorno es respaldo), qué hace cada código del proveedor con el
 * estado, y qué acepta el `PUT`.
 */

const FILA: AiCredentialSecret = {
  provider: "openrouter",
  baseUrl: OPENROUTER_BASE_URL,
  model: "org/modelo",
  tokenLast4: "1234",
  status: "active",
  statusReason: null,
  statusChangedAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  token: "sk-or-fila-1234",
};

const ENTORNO: AiProvider = {
  source: "env",
  baseUrl: "https://entorno.test",
  model: "env/modelo",
  judgeModel: "env/juez",
  token: "tok-entorno-9999",
};

describe("URLs del proveedor", () => {
  it("añade /v1 a la base del repo y no lo duplica si ya viene", () => {
    expect(apiRoot("https://openrouter.ai/api")).toBe("https://openrouter.ai/api/v1");
    expect(apiRoot("https://openrouter.ai/api/")).toBe("https://openrouter.ai/api/v1");
    expect(apiRoot("https://api.groq.com/openai/v1")).toBe("https://api.groq.com/openai/v1");
    expect(apiRoot("https://api.groq.com/openai/v1/")).toBe("https://api.groq.com/openai/v1");
    expect(chatCompletionsUrl("http://localhost:3000/api/dev/ai-mock")).toBe(
      "http://localhost:3000/api/dev/ai-mock/v1/chat/completions"
    );
    expect(modelsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/models");
  });

  it("reconoce el preset por la base URL", () => {
    expect(presetDeBaseUrl("https://openrouter.ai/api")).toBe("openrouter");
    expect(presetDeBaseUrl("https://openrouter.ai/api/v1/")).toBe("openrouter");
    expect(presetDeBaseUrl("https://api.openai.com")).toBe("openai_compatible");
  });

  it("last4 expone solo los últimos 4", () => {
    expect(last4("sk-or-abcdefgh-wxyz")).toBe("wxyz");
  });
});

describe("resolución: la fila manda, el entorno es respaldo", () => {
  it("fila activa → la fila, aunque el entorno tenga su propio token", () => {
    const r = resolver(FILA, ENTORNO);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider.source).toBe("org");
      expect(r.provider.token).toBe(FILA.token);
      expect(r.provider.model).toBe("org/modelo");
      // Un solo modelo en la UI: el juez usa el mismo.
      expect(r.provider.judgeModel).toBe("org/modelo");
    }
  });

  it("sin fila → el entorno tal cual (con su juez aparte)", () => {
    const r = resolver(null, ENTORNO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.provider).toEqual(ENTORNO);
  });

  it("sin nada → no configurado", () => {
    const r = resolver(null, null);
    expect(r).toEqual({ ok: false, estado: { activa: false, motivo: "sin_configurar" } });
  });

  it("fila pausada NO cae al entorno: el dueño configuró su llave y debe ver el problema", () => {
    const r = resolver({ ...FILA, status: "paused_invalid_token" }, ENTORNO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.estado).toEqual({
        activa: false,
        motivo: "token_invalido",
        last4: "1234",
        desde: FILA.statusChangedAt,
      });
    }
    const sinSaldo = resolver({ ...FILA, status: "paused_no_credit" }, null);
    expect(sinSaldo.ok).toBe(false);
    if (!sinSaldo.ok) expect(sinSaldo.estado.motivo).toBe("sin_saldo");
  });

  it("interpretarCredencial distingue el origen", () => {
    expect(interpretarCredencial(FILA, { last4: "9999" })).toEqual({
      activa: true,
      origen: "org",
      last4: "1234",
    });
    expect(interpretarCredencial(null, { last4: "9999" })).toEqual({
      activa: true,
      origen: "env",
      last4: "9999",
    });
    expect(interpretarCredencial(null, null)).toEqual({
      activa: false,
      motivo: "sin_configurar",
    });
  });
});

describe("la máquina de estados la dicta quien cobra", () => {
  it("401 pausa por llave, 402 por saldo; 429 y 500 no pausan", () => {
    expect(estadoSegunRespuesta(401)).toBe("paused_invalid_token");
    expect(estadoSegunRespuesta(402)).toBe("paused_no_credit");
    expect(estadoSegunRespuesta(429)).toBeNull();
    expect(estadoSegunRespuesta(500)).toBeNull();
    expect(estadoSegunRespuesta(200)).toBeNull();
  });

  it("cada motivo manda a Ajustes → IA; activa no dice nada", () => {
    expect(mensajeDeEstado({ activa: true, origen: "org", last4: "1234" })).toBeNull();
    for (const motivo of ["sin_configurar", "token_invalido", "sin_saldo"] as const) {
      const estado =
        motivo === "sin_configurar"
          ? { activa: false as const, motivo }
          : { activa: false as const, motivo, last4: "1234", desde: null };
      expect(mensajeDeEstado(estado)).toContain("Ajustes → IA");
    }
  });
});

describe("validación del PUT /api/settings/ai", () => {
  it("OpenRouter: proveedor + modelo + llave; la base URL la pone el preset", () => {
    const r = aiSettingsPutSchema.safeParse({
      provider: "openrouter",
      model: " anthropic/claude-sonnet-4.5 ",
      token: "sk-or-llave-larga",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.model).toBe("anthropic/claude-sonnet-4.5");
      expect(baseUrlEfectiva(r.data.provider, "https://otra.cosa")).toBe(OPENROUTER_BASE_URL);
    }
  });

  it("«Otro compatible» exige base URL http(s); se le quita la barra final", () => {
    const sin = aiSettingsPutSchema.safeParse({
      provider: "openai_compatible",
      model: "gpt-4.1-mini",
      token: "sk-llave-larga",
    });
    expect(sin.success).toBe(false);
    if (!sin.success) {
      expect(sin.error.issues.some((i) => i.path.join(".") === "baseUrl")).toBe(true);
    }
    const ftp = aiSettingsPutSchema.safeParse({
      provider: "openai_compatible",
      baseUrl: "ftp://api.x.com",
      model: "m",
      token: "sk-llave-larga",
    });
    expect(ftp.success).toBe(false);
    const ok = aiSettingsPutSchema.safeParse({
      provider: "openai_compatible",
      baseUrl: "https://api.x.com/",
      model: "m",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(baseUrlEfectiva(ok.data.provider, ok.data.baseUrl)).toBe("https://api.x.com");
    }
  });

  it("la llave es opcional (solo cambia proveedor/modelo), pero si viene tiene mínimo 8", () => {
    expect(
      aiSettingsPutSchema.safeParse({ provider: "openrouter", model: "m" }).success
    ).toBe(true);
    expect(
      aiSettingsPutSchema.safeParse({ provider: "openrouter", model: "m", token: "corta" })
        .success
    ).toBe(false);
    expect(
      aiSettingsPutSchema.safeParse({ provider: "openrouter", model: "", token: "sk-llave-larga" })
        .success
    ).toBe(false);
    expect(
      aiSettingsPutSchema.safeParse({ provider: "otro", model: "m", token: "sk-llave-larga" })
        .success
    ).toBe(false);
  });

  it("probar exige modelo; traer modelos no", () => {
    expect(aiProbeSchema.safeParse({ provider: "openrouter" }).success).toBe(false);
    expect(aiProbeSchema.safeParse({ provider: "openrouter", model: "m" }).success).toBe(true);
    expect(aiModelsSchema.safeParse({ provider: "openrouter" }).success).toBe(true);
    expect(
      aiModelsSchema.safeParse({ provider: "openai_compatible", token: "sk-llave-larga" }).success
    ).toBe(false);
  });
});

describe("el respaldo del entorno", () => {
  const original = { ...process.env };

  beforeAll(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    process.env = { ...original };
  });

  it("sin OPENROUTER_API_TOKEN → null, sin validar el resto del entorno", () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "");
    expect(envAiProvider()).toBeNull();
  });

  it("con token → proveedor del entorno; el juez cae al modelo principal", () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "tok-entorno-9999");
    vi.stubEnv("OPENROUTER_MODEL", "env/modelo");
    const p = envAiProvider();
    expect(p).toMatchObject({
      source: "env",
      baseUrl: "https://openrouter.ai/api",
      model: "env/modelo",
      judgeModel: "env/modelo",
      token: "tok-entorno-9999",
    });
  });
});
