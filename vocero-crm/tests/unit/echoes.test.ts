import { describe, expect, it } from "vitest";
import { mediaInputFrom } from "@/server/inbox/ingest";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * 008 — Parser tolerante de adjuntos del webhook (entrantes y echoes).
 * La integración completa (echo → hilo + pausa de IA) se ejercita en el
 * self-test E2E (scripts/e2e-selftest.mjs, sección 008).
 */
describe("mediaInputFrom (008)", () => {
  const base = { id: "wamid.x", timestamp: "1722800000" };

  it("imagen con media id → asset pending con mime y caption", () => {
    const msg: WebhookMessage = {
      ...base,
      type: "image",
      image: { id: "media9", mime_type: "image/jpeg", caption: "mira esto" },
    };
    expect(mediaInputFrom(msg)).toMatchObject({
      kind: "image",
      waMediaId: "media9",
      mimeType: "image/jpeg",
      caption: "mira esto",
      fetchStatus: "pending",
    });
  });

  it("documento conserva filename", () => {
    const msg: WebhookMessage = {
      ...base,
      type: "document",
      document: { id: "media10", mime_type: "application/pdf", filename: "cotizacion.pdf" },
    };
    expect(mediaInputFrom(msg)).toMatchObject({
      kind: "document",
      fileName: "cotizacion.pdf",
    });
  });

  it("media sin id (payload incompleto) → null, el mensaje se conserva sin adjunto", () => {
    const msg: WebhookMessage = { ...base, type: "image", image: {} };
    expect(mediaInputFrom(msg)).toBeNull();
  });

  it("ubicación válida → asset available con payload directo (sin binario)", () => {
    const msg: WebhookMessage = {
      ...base,
      type: "location",
      location: { latitude: 21.019, longitude: -101.257, name: "Oficina" },
    };
    expect(mediaInputFrom(msg)).toMatchObject({
      kind: "location",
      waMediaId: null,
      fetchStatus: "available",
      payload: { latitude: 21.019, longitude: -101.257, name: "Oficina" },
    });
  });

  it("ubicación sin coordenadas numéricas → null (tolerante, no revienta)", () => {
    const msg: WebhookMessage = {
      ...base,
      type: "location",
      location: { name: "??" },
    };
    expect(mediaInputFrom(msg)).toBeNull();
  });

  it("contacto compartido → asset available con la lista como payload", () => {
    const msg: WebhookMessage = {
      ...base,
      type: "contacts",
      contacts: [{ name: { formatted_name: "Xavier" }, phones: [{ phone: "+52123" }] }],
    };
    expect(mediaInputFrom(msg)).toMatchObject({
      kind: "contacts",
      fetchStatus: "available",
    });
  });

  it("texto plano → null", () => {
    const msg: WebhookMessage = { ...base, type: "text", text: { body: "hola" } };
    expect(mediaInputFrom(msg)).toBeNull();
  });
});
