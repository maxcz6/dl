import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registro automático del webhook en Meta (issue #84): la URL que se registra,
 * el verify token del handshake, la confirmación, los errores de Meta
 * traducidos a un código y un motivo —sin lanzar jamás: guardar la conexión
 * no puede fallar por esto— y la baja del override al desconectar.
 *
 * Aquí se habla con el cliente real (`graphRequest`) sobre un `fetch` falso,
 * para ver también la URL completa y el Bearer que salen por el cable.
 */

const env = vi.hoisted(() => ({
  APP_BASE_URL: "https://crm.ejemplo.test/",
  META_WEBHOOK_VERIFY_TOKEN: "verify-token-xyz",
  META_GRAPH_BASE_URL: "https://graph.facebook.com",
  META_GRAPH_API_VERSION: "v25.0",
}));
vi.mock("@/lib/env", () => ({ getEnv: () => env }));

import {
  registerWebhookForNumber,
  unregisterWebhookForNumber,
} from "@/server/whatsapp/connect";
import { webhookPath, webhookUrl, webhookVerifyToken } from "@/server/whatsapp/webhook-url";

const URL_PROPIA = "https://crm.ejemplo.test/api/webhooks/wa/verify-token-xyz";
const opts = {
  wabaId: "111",
  phoneNumberId: "222",
  token: "EAAG-token",
  webhookUrl: URL_PROPIA,
  verifyToken: "verify-token-xyz",
};

describe("la URL del webhook de esta instancia", () => {
  it("es APP_BASE_URL sin barra final + /api/webhooks/<canal>/<verify token>", () => {
    expect(webhookUrl()).toBe(URL_PROPIA);
    expect(webhookUrl("ig")).toBe("https://crm.ejemplo.test/api/webhooks/ig/verify-token-xyz");
    expect(webhookUrl("messenger")).toBe(
      "https://crm.ejemplo.test/api/webhooks/messenger/verify-token-xyz"
    );
    expect(webhookPath()).toBe("/api/webhooks/wa/verify-token-xyz");
    expect(webhookVerifyToken()).toBe("verify-token-xyz");
  });
});

describe("registro automático del webhook en Meta", () => {
  const fetchMock = vi.fn();
  const respond = (data: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }));
  const metaError = (status: number, code: number, message = "error de Meta") =>
    respond({ error: { message, code, type: "OAuthException" } }, status);
  const call = (i: number) => {
    const [url, init] = fetchMock.mock.calls[i]! as [string, RequestInit];
    return {
      url,
      method: init.method,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init.headers as Record<string, string>).Authorization,
    };
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sinOverride = () => respond({ data: [{ whatsapp_business_api_data: { id: "app-1" } }] });
  const confirmado = (application = "https://app-de-meta.test/webhook") =>
    respond({ webhook_configuration: { phone_number: URL_PROPIA, application }, id: "222" });

  it("suscribe la app a la WABA, pone el override en el NÚMERO con el verify token y lo confirma", async () => {
    sinOverride();
    respond({ success: true });
    respond({ success: true });
    confirmado();

    expect(await registerWebhookForNumber(opts)).toEqual({
      ok: true,
      appWithoutWebhook: false,
    });

    expect(call(0)).toMatchObject({
      url: "https://graph.facebook.com/v25.0/111/subscribed_apps",
      method: "GET",
      auth: "Bearer EAAG-token",
    });
    // 1 · Suscripción sin cuerpo, como la documenta Meta.
    expect(call(1)).toMatchObject({
      url: "https://graph.facebook.com/v25.0/111/subscribed_apps",
      method: "POST",
      body: undefined,
    });
    // 2 · Override del número, con el verify token que comprueba la ruta del
    // webhook en el handshake.
    expect(call(2)).toMatchObject({
      url: "https://graph.facebook.com/v25.0/222",
      method: "POST",
      body: {
        webhook_configuration: {
          override_callback_uri: URL_PROPIA,
          verify_token: "verify-token-xyz",
        },
      },
    });
    // 3 · Confirmación.
    expect(call(3)).toMatchObject({
      url: "https://graph.facebook.com/v25.0/222?fields=webhook_configuration",
      method: "GET",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("avisa si la app de Meta no tiene webhook propio", async () => {
    sinOverride();
    respond({ success: true });
    respond({ success: true });
    respond({ webhook_configuration: { phone_number: URL_PROPIA }, id: "222" });
    expect(await registerWebhookForNumber(opts)).toEqual({
      ok: true,
      appWithoutWebhook: true,
    });
  });

  it("sin permiso de gestión: lo dice y no sigue con el override", async () => {
    sinOverride();
    metaError(403, 200, "(#200) Permissions error");
    const res = await registerWebhookForNumber(opts);
    expect(res).toMatchObject({ ok: false, code: "missing_permission" });
    expect(!res.ok && res.message).toContain("whatsapp_business_management");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("si Meta no puede verificar la URL (2200), devuelve su motivo", async () => {
    sinOverride();
    respond({ success: true });
    metaError(400, 2200, "(#2200) Callback verification failed");
    const res = await registerWebhookForNumber(opts);
    expect(res).toMatchObject({ ok: false, code: "meta_error" });
    expect(!res.ok && res.message).toContain("Callback verification failed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("no da por bueno un override que Meta no confirma", async () => {
    sinOverride();
    respond({ success: true });
    respond({ success: true });
    respond({ webhook_configuration: { application: "https://app.test/w" }, id: "222" });
    expect(await registerWebhookForNumber(opts)).toMatchObject({
      ok: false,
      code: "meta_error",
    });
  });

  it("token inválido y Meta caída tienen su propio código, y ninguno lanza", async () => {
    metaError(401, 190, "Invalid OAuth access token");
    metaError(401, 190, "Invalid OAuth access token");
    expect(await registerWebhookForNumber(opts)).toMatchObject({
      ok: false,
      code: "invalid_token",
    });

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await registerWebhookForNumber(opts)).toMatchObject({
      ok: false,
      code: "meta_unavailable",
    });
    fetchMock.mockReset();
  });

  describe("al desconectar", () => {
    const quitar = {
      phoneNumberId: "222",
      token: "EAAG-token",
      webhookPath: "/api/webhooks/wa/verify-token-xyz",
    };

    it("quita el override del número si es el de esta instancia (aunque cambió el dominio)", async () => {
      respond({ webhook_configuration: { phone_number: URL_PROPIA.replace("crm.", "viejo.") } });
      respond({ success: true });
      await unregisterWebhookForNumber(quitar);
      expect(call(1)).toMatchObject({
        url: "https://graph.facebook.com/v25.0/222",
        method: "POST",
        body: { webhook_configuration: { override_callback_uri: "" } },
      });
    });

    it("no toca un override ajeno", async () => {
      respond({ webhook_configuration: { phone_number: "https://otra-plataforma.test/webhook" } });
      await unregisterWebhookForNumber(quitar);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("sin override en el número, no hay nada que quitar", async () => {
      respond({ webhook_configuration: { application: "https://app.test/w" } });
      await unregisterWebhookForNumber(quitar);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("no falla si Meta no contesta: desconectar sigue", async () => {
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expect(unregisterWebhookForNumber(quitar)).resolves.toBeUndefined();
    });
  });
});
