import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { registerWebhookForNumber } from "@/server/whatsapp/connect";

/**
 * Guardar la conexión de WhatsApp registra el webhook en el número, pero SIN
 * pisar un override de callback de la WABA: en Meta, `POST
 * {WABA}/subscribed_apps` sin cuerpo es exactamente cómo se elimina el
 * callback alterno, y el override del número tiene prioridad sobre el de la
 * WABA. Con cualquiera de las dos cosas, un cerebro externo (Nea) o el backend
 * de una agencia dejaba de recibir mensajes cada vez que alguien pulsaba
 * "Guardar" o rotaba el token.
 */

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const WABA = "WABA-1";
const PHONE = "PN-1";
const TOKEN = "EAAG-token-secreto-1234";
const APP = { id: "123", name: "Mi app", link: "https://www.facebook.com/games/?app_id=123" };
/** El webhook de esta instancia: el verify token es el segmento secreto. */
const URL_PROPIA = "https://crm.ejemplo.com/api/webhooks/wa/verify-secreto-xyz";
/** El override de Nea lleva también su propio segmento secreto. */
const OVERRIDE = "https://nea.ejemplo.com/api/webhooks/wa/segmento-secreto-abc";

const opts = {
  wabaId: WABA,
  phoneNumberId: PHONE,
  token: TOKEN,
  webhookUrl: URL_PROPIA,
  verifyToken: "verify-secreto-xyz",
};

type Call = [path: string, opts: { method?: string; token: string; body?: unknown }];
const calls = () => graphRequest.mock.calls as Call[];
const posts = () => calls().filter(([, o]) => o.method === "POST");
const subscriptions = () =>
  posts().filter(([path]) => path === `${WABA}/subscribed_apps`);

/**
 * Una «Meta» mínima: responde según la ruta, y recuerda el override del
 * número para que la confirmación lo devuelva tal cual lo pusieron.
 */
function metaFalsa(subscribedApps: unknown, phoneOverride: string | null = null) {
  let override = phoneOverride;
  graphRequest.mockImplementation(async (path: string, o: Call[1]) => {
    const method = o.method ?? "GET";
    if (path === `${WABA}/subscribed_apps` && method === "GET") {
      if (subscribedApps instanceof Error) throw subscribedApps;
      return subscribedApps;
    }
    if (path === `${WABA}/subscribed_apps` && method === "POST") return { success: true };
    if (path === PHONE && method === "POST") {
      const config = (o.body as { webhook_configuration: { override_callback_uri: string } })
        .webhook_configuration;
      override = config.override_callback_uri || null;
      return { success: true };
    }
    if (path === `${PHONE}?fields=webhook_configuration`) {
      return {
        webhook_configuration: {
          ...(override ? { phone_number: override } : {}),
          application: "https://app.ejemplo.com/webhook",
        },
        id: PHONE,
      };
    }
    throw new Error(`ruta inesperada en la prueba: ${method} ${path}`);
  });
  return { get override() { return override; } };
}

let log: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  graphRequest.mockReset();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  warn.mockRestore();
});

/** Todo lo que se escribió en consola, para buscar secretos filtrados. */
function consoleText(): string {
  return [...log.mock.calls, ...warn.mock.calls].flat().map(String).join("\n");
}

describe("registerWebhookForNumber — la WABA ya enruta a un override ajeno", () => {
  it("consulta subscribed_apps, NO re-suscribe y NO registra el número: lo respeta", async () => {
    const meta = metaFalsa({
      data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }],
    });

    await expect(registerWebhookForNumber(opts)).resolves.toEqual({
      ok: true,
      skipped: "waba_override",
      host: "nea.ejemplo.com",
    });

    const [path, o] = calls()[0]!;
    expect(path).toBe(`${WABA}/subscribed_apps`);
    expect(o.method ?? "GET").toBe("GET");
    expect(o.token).toBe(TOKEN);
    expect(subscriptions()).toHaveLength(0);
    expect(meta.override).toBeNull();
  });

  it("si un guardado anterior dejó NUESTRO override en el número, lo quita: el del número ganaría", async () => {
    const meta = metaFalsa(
      { data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }] },
      URL_PROPIA
    );

    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ skipped: "waba_override" });

    expect(meta.override).toBeNull();
    const quitar = posts().find(([path]) => path === PHONE);
    expect(quitar?.[1].body).toEqual({ webhook_configuration: { override_callback_uri: "" } });
  });

  it("un override ajeno en el número no se toca", async () => {
    const meta = metaFalsa(
      { data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }] },
      "https://otra-plataforma.test/webhook"
    );
    await registerWebhookForNumber(opts);
    expect(meta.override).toBe("https://otra-plataforma.test/webhook");
    expect(posts()).toHaveLength(0);
  });

  it("lo deja dicho en el log, sin el token ni las rutas secretas", async () => {
    metaFalsa({
      data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }],
    });

    await registerWebhookForNumber(opts);

    const text = consoleText();
    expect(text).toMatch(/override/);
    expect(text).toContain(WABA);
    expect(text).toContain("nea.ejemplo.com");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("segmento-secreto-abc");
    expect(text).not.toContain("verify-secreto-xyz");
  });

  it("basta con que UNA de las apps suscritas tenga override", async () => {
    metaFalsa({
      data: [
        { whatsapp_business_api_data: { id: "999", name: "Otra app" } },
        { whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE },
      ],
    });

    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ skipped: "waba_override" });
    expect(subscriptions()).toHaveLength(0);
  });
});

describe("registerWebhookForNumber — la WABA ya enruta a ESTA instancia (override de agencia)", () => {
  it("no re-suscribe (lo borraría) y registra el número igual: mismo destino", async () => {
    const meta = metaFalsa({
      data: [
        {
          whatsapp_business_api_data: APP,
          // Otro dominio, misma ruta: la instancia cambió de dominio.
          override_callback_uri: "https://viejo.ejemplo.com/api/webhooks/wa/verify-secreto-xyz",
        },
      ],
    });

    await expect(registerWebhookForNumber(opts)).resolves.toEqual({
      ok: true,
      appWithoutWebhook: false,
    });
    expect(subscriptions()).toHaveLength(0);
    expect(meta.override).toBe(URL_PROPIA);
  });
});

describe("registerWebhookForNumber — sin override (modo directo)", () => {
  it("app suscrita sin override → suscribe como siempre y registra el número", async () => {
    const meta = metaFalsa({ data: [{ whatsapp_business_api_data: APP }] });

    await expect(registerWebhookForNumber(opts)).resolves.toEqual({
      ok: true,
      appWithoutWebhook: false,
    });

    expect(subscriptions()).toEqual([[`${WABA}/subscribed_apps`, { method: "POST", token: TOKEN }]]);
    expect(meta.override).toBe(URL_PROPIA);
  });

  it("ninguna app suscrita todavía (data vacío) → suscribe", async () => {
    metaFalsa({ data: [] });
    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ ok: true });
    expect(subscriptions()).toHaveLength(1);
  });

  it("un override vacío o en blanco no cuenta como override", async () => {
    metaFalsa({ data: [{ whatsapp_business_api_data: APP, override_callback_uri: "  " }] });
    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ ok: true });
    expect(subscriptions()).toHaveLength(1);
  });

  it("una respuesta sin `data` (o vacía) se trata como sin override", async () => {
    metaFalsa({});
    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ ok: true });
    expect(subscriptions()).toHaveLength(1);

    graphRequest.mockReset();
    metaFalsa(null);
    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ ok: true });
    expect(subscriptions()).toHaveLength(1);
  });
});

describe("registerWebhookForNumber — la consulta falla", () => {
  it("se conserva el POST best-effort de siempre y se sigue con el número", async () => {
    const meta = metaFalsa(new MetaApiError("(#200) Permissions error", { status: 403, code: 200 }));

    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({ ok: true });
    expect(subscriptions()).toHaveLength(1);
    expect(meta.override).toBe(URL_PROPIA);
    expect(warn).toHaveBeenCalled();
    expect(consoleText()).not.toContain(TOKEN);
  });

  it("si también falla la suscripción, lo dice y NO lanza (guardar sigue)", async () => {
    graphRequest
      .mockRejectedValueOnce(new MetaApiError("No se pudo contactar la API de Meta", { status: 0 }))
      .mockRejectedValueOnce(new MetaApiError("No se pudo contactar la API de Meta", { status: 0 }));

    await expect(registerWebhookForNumber(opts)).resolves.toMatchObject({
      ok: false,
      code: "meta_unavailable",
    });
    expect(posts()).toHaveLength(1);
    expect(consoleText()).not.toContain(TOKEN);
  });
});

describe("035 — «Recuperar el webhook» (forzar)", () => {
  it("con override ajeno en la WABA, lo quita (re-suscribe sin cuerpo) y registra el del número", async () => {
    const meta = metaFalsa({
      data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }],
    });

    await expect(registerWebhookForNumber({ ...opts, forzar: true })).resolves.toMatchObject({ ok: true });

    expect(meta.override).toBe(URL_PROPIA);
    // Sin cuerpo: así borra Meta el override de la WABA. Si se quedara, el
    // siguiente «Guardar» quitaría el del número.
    expect(subscriptions()).toHaveLength(1);
    expect(subscriptions()[0]![1].body).toBeUndefined();
  });

  it("el log dice que se quitó, sin la ruta secreta del override", async () => {
    metaFalsa({ data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }] });
    await registerWebhookForNumber({ ...opts, forzar: true });
    expect(consoleText()).toContain("nea.ejemplo.com");
    expect(consoleText()).not.toContain("segmento-secreto-abc");
  });

  it("también pisa un override ajeno en el número (el de Nea 1.x)", async () => {
    const meta = metaFalsa(
      { data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }] },
      "https://nea.ejemplo.com/webhook"
    );
    await registerWebhookForNumber({ ...opts, forzar: true });
    expect(meta.override).toBe(URL_PROPIA);
  });
});
