import { describe, expect, it } from "vitest";
import { contenidoEntrante, mediaInputFrom } from "@/server/inbox/ingest";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * #78 — Las respuestas de botón (`type: "button"` e `"interactive"`) se
 * descartaban: no llegaban a la bandeja, no abrían la ventana de 24 h ni
 * disparaban al agente. Ahora entran como texto con el rótulo del botón.
 *
 * Los payloads son los que documenta Meta para el webhook `messages`
 * (referencia «Button» e «Interactive»); la integración completa (bandeja,
 * ventana, agente) se ejercita en scripts/e2e-selftest.mjs.
 */

const base = { from: "16505551234", id: "wamid.HBgL.test", timestamp: "1750025136" };

/** Respuesta a un botón de respuesta rápida de una plantilla. */
const botonDePlantilla: WebhookMessage = {
  ...base,
  context: { from: "15550783881", id: "wamid.HBgL.plantilla" },
  type: "button",
  button: { payload: "No-Button-Payload", text: "No" },
};

/** Botón de un mensaje interactivo. */
const botonInteractivo: WebhookMessage = {
  ...base,
  context: { from: "15550783881", id: "wamid.HBgL.interactivo" },
  type: "interactive",
  interactive: {
    type: "button_reply",
    button_reply: { id: "cancel-button", title: "Cancel" },
  },
};

/** Fila de una lista interactiva. */
const filaDeLista: WebhookMessage = {
  ...base,
  context: { from: "15550783881", id: "wamid.HBgL.lista" },
  type: "interactive",
  interactive: {
    type: "list_reply",
    list_reply: {
      id: "priority_express",
      title: "Priority Mail Express",
      description: "Next Day to 2 Days",
    },
  },
};

describe("contenidoEntrante: respuestas de botón (#78)", () => {
  it("un botón de plantilla entra como texto con su rótulo", () => {
    expect(contenidoEntrante(botonDePlantilla)).toEqual({ type: "text", text: "No" });
  });

  it("un botón interactivo entra como texto con su título, no con su id", () => {
    expect(contenidoEntrante(botonInteractivo)).toEqual({ type: "text", text: "Cancel" });
  });

  it("una fila de lista entra como texto con su título, no con la descripción", () => {
    expect(contenidoEntrante(filaDeLista)).toEqual({
      type: "text",
      text: "Priority Mail Express",
    });
  });

  it("si falta el rótulo, vale el payload/id antes que perder la respuesta", () => {
    expect(
      contenidoEntrante({ ...base, type: "button", button: { payload: "SI_INTERESA" } })
    ).toEqual({ type: "text", text: "SI_INTERESA" });
    expect(
      contenidoEntrante({
        ...base,
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "btn_1" } },
      })
    ).toEqual({ type: "text", text: "btn_1" });
  });

  it("recorta espacios y trata un rótulo en blanco como ausente", () => {
    expect(
      contenidoEntrante({ ...base, type: "button", button: { text: "  Sí  ", payload: "" } })
    ).toEqual({ type: "text", text: "Sí" });
  });

  it("sin rótulo ni identificador → null (se descarta con aviso, no revienta)", () => {
    expect(contenidoEntrante({ ...base, type: "button" })).toBeNull();
    expect(contenidoEntrante({ ...base, type: "button", button: {} })).toBeNull();
    expect(
      contenidoEntrante({ ...base, type: "interactive", interactive: { type: "button_reply" } })
    ).toBeNull();
    expect(
      contenidoEntrante({
        ...base,
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: "   ", title: "" } },
      })
    ).toBeNull();
  });

  it("un mensaje de texto pasa tal cual", () => {
    expect(contenidoEntrante({ ...base, type: "text", text: { body: "hola" } })).toEqual({
      type: "text",
      text: "hola",
    });
  });

  it("los demás tipos conservan su tipo y no inventan texto", () => {
    expect(
      contenidoEntrante({ ...base, type: "image", image: { id: "m1", mime_type: "image/jpeg" } })
    ).toEqual({ type: "image", text: null });
  });

  it("una respuesta de botón no lleva adjunto", () => {
    expect(mediaInputFrom(botonDePlantilla)).toBeNull();
    expect(mediaInputFrom(filaDeLista)).toBeNull();
  });
});
