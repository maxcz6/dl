import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `BRAIN_HEALTH_URL` es opcional y solo de diagnóstico: un valor mal escrito
 * no puede tumbar el CRM. Con `.url()` en el esquema, `getEnv()` lanzaba y
 * toda la app respondía 503 por una tarjeta. Ahora la tarjeta lo marca
 * (`problem: "config"`) y lo demás sigue.
 */

const BASE = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "token-de-prueba",
};

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
});

describe("BRAIN_HEALTH_URL no tumba el arranque", () => {
  it.each(["nea:8000/health", "ftp://nea/health", "no es una url"])(
    "%s → getEnv no lanza y la conserva tal cual",
    async (valor) => {
      process.env = { ...original, ...BASE, BRAIN_HEALTH_URL: valor };
      vi.resetModules();
      const { getEnv } = await import("@/lib/env");
      expect(getEnv().BRAIN_HEALTH_URL).toBe(valor);
    }
  );
});
