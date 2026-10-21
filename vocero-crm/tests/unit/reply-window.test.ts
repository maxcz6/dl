import { describe, expect, it } from "vitest";
import { CHANNEL_ORDER } from "@/lib/channels";
import {
  aiWindowClosedMessage,
  capabilitiesFor,
  windowClosedMessage,
} from "@/server/channels/capabilities";
import { replyWindow } from "@/server/inbox/window";

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const AHORA = new Date("2026-10-13T12:00:00Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

describe("024 · quién puede escribir (replyWindow)", () => {
  it("Instagram y Messenger: dentro de 24 h escribe cualquiera, sin etiqueta", () => {
    for (const canal of ["instagram", "messenger"] as const) {
      const w = replyWindow(canal, hace(23 * HORA), AHORA);
      expect(w).toMatchObject({ standardOpen: true, operatorOpen: true, humanAgentTag: false });
      expect(w.operatorRemainingMs).toBe(7 * DIA - 23 * HORA);
    }
  });

  it("a las 24 h exactas cierra la ventana normal y empieza la atención humana", () => {
    const antes = replyWindow("instagram", hace(DIA - 1), AHORA);
    expect(antes).toMatchObject({ standardOpen: true, humanAgentTag: false });
    const justo = replyWindow("instagram", hace(DIA), AHORA);
    expect(justo).toMatchObject({ standardOpen: false, operatorOpen: true, humanAgentTag: true });
    expect(justo.operatorRemainingMs).toBe(6 * DIA);
  });

  it("a los 7 días exactos cierra para todos", () => {
    const antes = replyWindow("messenger", hace(7 * DIA - 1), AHORA);
    expect(antes).toMatchObject({ operatorOpen: true, humanAgentTag: true, operatorRemainingMs: 1 });
    const justo = replyWindow("messenger", hace(7 * DIA), AHORA);
    expect(justo).toEqual({
      standardOpen: false,
      operatorOpen: false,
      humanAgentTag: false,
      operatorRemainingMs: 0,
    });
  });

  it("WhatsApp y TikTok no tienen extensión: cierran con su ventana", () => {
    expect(replyWindow("whatsapp", hace(23 * HORA), AHORA).operatorOpen).toBe(true);
    expect(replyWindow("whatsapp", hace(25 * HORA), AHORA)).toMatchObject({
      standardOpen: false,
      operatorOpen: false,
      humanAgentTag: false,
    });
    expect(replyWindow("tiktok", hace(47 * HORA), AHORA)).toMatchObject({
      standardOpen: true,
      operatorOpen: true,
      humanAgentTag: false,
    });
    expect(replyWindow("tiktok", hace(49 * HORA), AHORA).operatorOpen).toBe(false);
  });

  it("sin mensajes del cliente, con fecha inválida o del futuro no hay ventana", () => {
    for (const canal of CHANNEL_ORDER) {
      for (const fecha of [null, new Date("no es una fecha"), new Date(AHORA.getTime() + HORA)]) {
        expect(replyWindow(canal, fecha, AHORA)).toEqual({
          standardOpen: false,
          operatorOpen: false,
          humanAgentTag: false,
          operatorRemainingMs: 0,
        });
      }
    }
  });
});

describe("024 · capacidades por canal", () => {
  it("la extensión humana es de Instagram y Messenger, 7 días", () => {
    expect(capabilitiesFor("instagram").humanAgentWindowMs).toBe(7 * DIA);
    expect(capabilitiesFor("messenger").humanAgentWindowMs).toBe(7 * DIA);
    expect(capabilitiesFor("whatsapp").humanAgentWindowMs).toBeNull();
    expect(capabilitiesFor("tiktok").humanAgentWindowMs).toBeNull();
  });

  it("solo WhatsApp dibuja su formato; las redes reciben texto plano", () => {
    expect(capabilitiesFor("whatsapp").textFormat).toBe("whatsapp");
    for (const canal of ["instagram", "messenger", "tiktok"] as const) {
      expect(capabilitiesFor(canal).textFormat).toBe("plain");
    }
  });

  it("todo canal con etiqueta de agente humano declara hasta cuándo", () => {
    for (const canal of CHANNEL_ORDER) {
      const caps = capabilitiesFor(canal);
      expect(caps.outsideWindow === "human_agent_tag").toBe(caps.humanAgentWindowMs !== null);
    }
  });

  it("los mensajes de ventana cerrada dicen el canal y el plazo", () => {
    expect(windowClosedMessage("instagram")).toContain("Instagram");
    expect(windowClosedMessage("instagram")).toContain("7 días");
    expect(windowClosedMessage("messenger")).toContain("Messenger");
    expect(aiWindowClosedMessage("instagram")).toContain("24 horas");
    expect(aiWindowClosedMessage("instagram")).toContain("una persona");
    // WhatsApp sigue pidiendo plantilla.
    expect(windowClosedMessage("whatsapp")).toContain("plantilla");
  });
});
