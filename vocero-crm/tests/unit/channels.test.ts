import { describe, expect, it } from "vitest";
import { CHANNEL_LABEL, CHANNEL_ORDER, isChannel } from "@/lib/channels";
import { parseChannels } from "@/server/channels/enabled";
import { capabilitiesFor, textFits } from "@/server/channels/capabilities";
import { channelMark } from "@/components/channel-badge";

describe("CHANNELS: qué bandejas enciende la instancia (ADR-001)", () => {
  it("sin la variable, la instancia es de un solo canal", () => {
    expect([...parseChannels(undefined)]).toEqual(["whatsapp"]);
    expect([...parseChannels("")]).toEqual(["whatsapp"]);
  });

  it("enciende lo que se le pida, con espacios y mayúsculas de por medio", () => {
    const on = parseChannels("  Instagram , WHATSAPP ");
    expect(on.has("instagram")).toBe(true);
    expect(on.has("whatsapp")).toBe(true);
  });

  it("WhatsApp no se puede apagar: es el canal por el que existe el producto", () => {
    expect(parseChannels("instagram").has("whatsapp")).toBe(true);
  });

  it("un canal que no existe se ignora, no tumba el arranque", () => {
    const on = parseChannels("telegram,instagram,,");
    expect([...on].sort()).toEqual(["instagram", "whatsapp"]);
  });

  it("isChannel es la única lista: no hay uniones sueltas por ahí", () => {
    expect(isChannel("whatsapp")).toBe(true);
    expect(isChannel("instagram")).toBe(true);
    expect(isChannel("telegram")).toBe(false);
    expect(isChannel("")).toBe(false);
  });
});

describe("capacidades por canal", () => {
  it("el nombre visible sale de un solo lugar", () => {
    for (const ch of CHANNEL_ORDER) {
      expect(capabilitiesFor(ch).label).toBe(CHANNEL_LABEL[ch]);
    }
  });

  it("un canal desconocido cae en WhatsApp en vez de reventar", () => {
    const caps = capabilitiesFor("telegram" as never);
    expect(caps.label).toBe(CHANNEL_LABEL.whatsapp);
  });

  it("el límite de Instagram es en BYTES: los acentos cuentan doble", () => {
    // 600 acentos = 1200 bytes. Contando caracteres esto pasaría, y Meta
    // rechazaría el envío con un 400 que el operador no sabría leer.
    expect(textFits("instagram", "é".repeat(600))).toBe(false);
    expect(textFits("instagram", "a".repeat(600))).toBe(true);
    expect(textFits("instagram", "a".repeat(1001))).toBe(false);
  });

  it("WhatsApp declara su límite de 4,096 caracteres, que antes vivía en el esquema de la API", () => {
    // 022: el tope dejó de ser uno global para todos los canales (TikTok
    // admite 6,000), así que el de WhatsApp se declara aquí. Se cuenta en
    // caracteres: 4,096 acentos son 8,192 bytes y caben.
    expect(textFits("whatsapp", "a".repeat(4096))).toBe(true);
    expect(textFits("whatsapp", "é".repeat(4096))).toBe(true);
    expect(textFits("whatsapp", "a".repeat(5000))).toBe(false);
  });
});

describe("distintivo de bandeja", () => {
  it("todo canal del catálogo tiene su marca dibujada", () => {
    // Sin esto, agregar un canal y olvidar su glifo no rompe nada: el
    // distintivo devuelve null y la bandeja se ve como si no tuviera canal.
    for (const ch of CHANNEL_ORDER) {
      expect(channelMark(ch)).not.toBeNull();
    }
  });

  it("un canal desconocido no pinta nada en vez de tumbar la lista", () => {
    expect(channelMark("telegram" as never)).toBeNull();
  });
});
