import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_SCOPE, googleConnector } from "@/server/agenda/connectors/google";
import { clearGoogleTokenCache } from "@/server/agenda/connectors/google-credentials";

/**
 * 015 / issue #50, puntos 2 y 3 — Los dos fallos del conector de Google que
 * hacen que conectarlo parezca roto cuando no lo está.
 *
 * Los dos se comprueban por la FRONTERA de red: lo que importa no es cómo se
 * llame la función interna, sino a qué endpoint se llama y cuántas veces se
 * pide el token. Un test acoplado a los nombres pasaría con el bug puesto en
 * cuanto alguien renombrara algo.
 */

const CREDS = {
  clientId: "cid",
  clientSecret: "secreto-1",
  refreshToken: "refresh-1",
  calendarId: "primary",
} as never;

let llamadas: string[] = [];

function responder(url: string): Response {
  llamadas.push(url);
  if (url.includes("/token")) {
    return new Response(
      JSON.stringify({ access_token: `tok-${llamadas.length}`, expires_in: 3600 }),
      { status: 200 }
    );
  }
  return new Response(JSON.stringify({ summary: "Mi calendario" }), {
    status: 200,
  });
}

beforeEach(() => {
  llamadas = [];
  clearGoogleTokenCache();
  // `getEnv()` valida el entorno entero: sin lo mínimo, el conector falla
  // antes de tocar la red y el test mediría otra cosa.
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
  vi.stubEnv("GOOGLE_OAUTH_BASE_URL", "https://oauth.test");
  vi.stubEnv("GOOGLE_CAL_BASE_URL", "https://cal.test");
  globalThis.fetch = ((url: string) =>
    Promise.resolve(responder(String(url)))) as typeof fetch;
});

describe("punto 2 — la prueba de conexión cabe en el scope documentado", () => {
  /**
   * `GET /calendars/{id}` es `Calendars.Get`, y Google solo lo concede con
   * `calendar.readonly` o superior. Con el scope que este conector pide de
   * verdad, esa llamada devolvía 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT: la
   * conexión funcionaba y su propia prueba fallaba.
   */
  it("lista eventos en vez de leer el calendario", async () => {
    const r = await googleConnector.testConnection!(CREDS);
    expect(r.ok).toBe(true);

    const api = llamadas.filter((u) => !u.includes("/token"));
    expect(api).toHaveLength(1);
    expect(api[0]).toContain("/events");
    // La llamada que exigía más permiso del documentado.
    expect(api[0]).not.toMatch(/\/calendars\/[^/]+$/);
  });

  it("y el scope que se pide sigue siendo el mínimo", () => {
    // Si algún día hiciera falta `readonly`, esta prueba obliga a decirlo aquí
    // y en la guía de la pantalla, en vez de descubrirlo con un 403.
    expect(GOOGLE_SCOPE).toBe("https://www.googleapis.com/auth/calendar.events");
  });
});

describe("punto 3 — el caché del token distingue credenciales", () => {
  it("las mismas credenciales reutilizan el token (el caché sirve)", async () => {
    await googleConnector.testConnection!(CREDS);
    await googleConnector.testConnection!(CREDS);
    expect(llamadas.filter((u) => u.includes("/token"))).toHaveLength(1);
  });

  /**
   * El síntoma real: tras regenerar el refresh token, la prueba seguía
   * devolviendo el MISMO error, palabra por palabra, durante una hora. El
   * operador concluye que el token nuevo también está mal.
   */
  it("un refresh token distinto pide un token NUEVO, sin esperar a que expire", async () => {
    await googleConnector.testConnection!(CREDS);
    await googleConnector.testConnection!({
      ...(CREDS as object),
      refreshToken: "refresh-2",
    } as never);
    expect(llamadas.filter((u) => u.includes("/token"))).toHaveLength(2);
  });

  it("y cambiar solo el secreto también cuenta", async () => {
    await googleConnector.testConnection!(CREDS);
    await googleConnector.testConnection!({
      ...(CREDS as object),
      clientSecret: "secreto-2",
    } as never);
    expect(llamadas.filter((u) => u.includes("/token"))).toHaveLength(2);
  });
});
