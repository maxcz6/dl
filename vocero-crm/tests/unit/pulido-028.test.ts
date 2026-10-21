import { describe, expect, it } from "vitest";
import { CHANNEL_CAPABILITIES } from "@/server/channels/capabilities";
import { channelList, emptyInboxDescription } from "@/components/inbox/helpers";
import { navKicker } from "@/lib/channels";
import { initials } from "@/lib/utils";

/** 028 — Pulido visual de la 1.6. */

describe("lo que el compositor ofrece por canal (D1)", () => {
  it("solo WhatsApp admite ubicación y contactos", () => {
    expect(CHANNEL_CAPABILITIES.whatsapp.structuredMessages).toBe(true);
    expect(CHANNEL_CAPABILITIES.instagram.structuredMessages).toBe(false);
    expect(CHANNEL_CAPABILITIES.messenger.structuredMessages).toBe(false);
    expect(CHANNEL_CAPABILITIES.tiktok.structuredMessages).toBe(false);
  });

  it("solo WhatsApp manda adjuntos hoy", () => {
    expect(CHANNEL_CAPABILITIES.whatsapp.outboundMedia).toBe(true);
    for (const ch of ["instagram", "messenger", "tiktok"] as const) {
      expect(CHANNEL_CAPABILITIES[ch].outboundMedia).toBe(false);
    }
  });
});

describe("la bandeja vacía nombra los canales encendidos (D2)", () => {
  it("une los canales como se dice", () => {
    expect(channelList(["WhatsApp"])).toBe("WhatsApp");
    expect(channelList(["WhatsApp", "Instagram"])).toBe("WhatsApp o Instagram");
    expect(channelList(["WhatsApp", "Instagram", "Messenger"])).toBe(
      "WhatsApp, Instagram o Messenger"
    );
  });

  it("con solo WhatsApp, el texto de siempre", () => {
    expect(emptyInboxDescription(["WhatsApp"])).toBe(
      "Cuando alguien escriba a tu número de WhatsApp, su conversación aparecerá aquí en tiempo real."
    );
  });

  it("con varios canales, los nombra todos", () => {
    expect(emptyInboxDescription(["WhatsApp", "Instagram", "Messenger", "TikTok"])).toBe(
      "Cuando alguien te escriba por WhatsApp, Instagram, Messenger o TikTok, su conversación aparecerá aquí en tiempo real."
    );
  });
});

describe("la etiqueta bajo el logo (D6)", () => {
  it("con solo WhatsApp, la de siempre; con más canales, Multicanal", () => {
    expect(navKicker(["whatsapp"])).toBe("CRM · WhatsApp");
    expect(navKicker(["whatsapp", "instagram"])).toBe("CRM · Multicanal");
  });
});

describe("las iniciales del avatar ignoran los emojis (D7)", () => {
  it("nombres de redes con emojis", () => {
    expect(initials("Kevin Belier 🐏")).toBe("KB");
    expect(initials("Vivir con virtud ⚖️ 🌿")).toBe("VV");
    expect(initials("🌿 Ana")).toBe("A");
    expect(initials("🐏")).toBe("?");
  });

  it("los nombres de siempre no cambian", () => {
    expect(initials("María López")).toBe("ML");
    expect(initials("Ángel")).toBe("Á");
    expect(initials("  ")).toBe("?");
    expect(initials("5215512345678")).toBe("5");
  });
});
