import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #85 — La llave del proveedor de IA se guarda cifrada (jamás texto plano en
 * la fila), a la UI solo viajan sus últimos 4, y el estado lo escribe el
 * adaptador según lo que respondió el proveedor.
 */

const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];
/** Lo que devuelve el UPDATE … RETURNING: vacío = no había fila. */
let filaExistente: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          onConflictDoUpdate: () => ({
            returning: () =>
              Promise.resolve([
                { ...v, createdAt: new Date(), updatedAt: new Date() },
              ]),
          }),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updated.push(v);
        return {
          where: () => {
            const rows = filaExistente.map((f) => ({ ...f, ...v }));
            return {
              returning: () => Promise.resolve(rows),
              then: (resolve: (x: unknown) => void) =>
                Promise.resolve(rows).then(resolve),
            };
          },
        };
      },
    }),
  }),
  schema: {
    aiCredentials: { organizationId: "organization_id" },
  },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  filaExistente = [];
});

describe("saveAiCredential", () => {
  it("cifra la llave: la fila no contiene el texto plano y queda activa", async () => {
    const { saveAiCredential } = await import("@/server/ai/credentials");
    const token = "sk-or-llave-super-secreta-abcd";
    const guardada = await saveAiCredential({
      organizationId: "org_1",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api",
      model: "anthropic/claude-sonnet-4.5",
      token,
    });
    const row = inserted[0]!;
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenCipher).toBeTruthy();
    expect(row.tokenIv).toBeTruthy();
    expect(row.tokenTag).toBeTruthy();
    expect(row.tokenLast4).toBe("abcd");
    expect(row.status).toBe("active");
    expect(row.statusReason).toBeNull();
    expect(String(row.id)).toMatch(/^aicred_/);

    // y el cifrado es reversible con la clave de la instancia
    const { decryptSecret } = await import("@/lib/crypto");
    expect(
      decryptSecret({
        cipher: row.tokenCipher as string,
        iv: row.tokenIv as string,
        tag: row.tokenTag as string,
      })
    ).toBe(token);

    // lo que vuelve hacia fuera no trae el token ni el cifrado
    expect(JSON.stringify(guardada)).not.toContain(token);
    expect(guardada).not.toHaveProperty("tokenCipher");
    expect(guardada.tokenLast4).toBe("abcd");
  });

  it("sin llave y sin fila → error tipado sin_token (no inserta nada)", async () => {
    const { saveAiCredential, AiCredentialError } = await import(
      "@/server/ai/credentials"
    );
    await expect(
      saveAiCredential({
        organizationId: "org_1",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api",
        model: "m",
      })
    ).rejects.toBeInstanceOf(AiCredentialError);
    expect(inserted).toHaveLength(0);
  });

  it("sin llave con fila → solo cambia proveedor/modelo y conserva el estado", async () => {
    filaExistente = [
      {
        id: "aicred_1",
        organizationId: "org_1",
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api",
        model: "viejo",
        tokenCipher: "c",
        tokenIv: "i",
        tokenTag: "t",
        tokenLast4: "zzzz",
        status: "paused_invalid_token",
        statusReason: "401",
        statusChangedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const { saveAiCredential } = await import("@/server/ai/credentials");
    const guardada = await saveAiCredential({
      organizationId: "org_1",
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api",
      model: "nuevo",
    });
    expect(guardada.model).toBe("nuevo");
    expect(guardada.status).toBe("paused_invalid_token");
    expect(updated[0]).not.toHaveProperty("status");
    expect(updated[0]).not.toHaveProperty("tokenCipher");
  });
});

describe("el estado según el proveedor", () => {
  it("401 → paused_invalid_token con el detalle; 402 → paused_no_credit", async () => {
    const { marcarEstadoPorRespuesta } = await import("@/server/ai/credentials");
    expect(await marcarEstadoPorRespuesta("org_1", 401, "proveedor respondió 401")).toBe(true);
    expect(updated[0]).toMatchObject({
      status: "paused_invalid_token",
      statusReason: "proveedor respondió 401",
    });
    expect(await marcarEstadoPorRespuesta("org_1", 402)).toBe(true);
    expect(updated[1]).toMatchObject({ status: "paused_no_credit", statusReason: null });
  });

  it("429 y 500 no tocan la fila", async () => {
    const { marcarEstadoPorRespuesta } = await import("@/server/ai/credentials");
    expect(await marcarEstadoPorRespuesta("org_1", 429)).toBe(false);
    expect(await marcarEstadoPorRespuesta("org_1", 500)).toBe(false);
    expect(updated).toHaveLength(0);
  });

  it("marcarActiva vuelve a active y limpia el motivo", async () => {
    const { marcarActiva } = await import("@/server/ai/credentials");
    await marcarActiva("org_1");
    expect(updated[0]).toMatchObject({ status: "active", statusReason: null });
  });
});
