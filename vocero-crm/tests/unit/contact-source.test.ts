import { describe, expect, it } from "vitest";
import {
  effectiveSource,
  isSourceValue,
  SOURCE_LABELS,
  SOURCE_VALUES,
} from "@/server/contact-source";

/* Fuente del prospecto: lo capturado manda, lo demás queda sin identificar. */

describe("fuente efectiva", () => {
  it("lo que capturó el dueño se marca como capturado", () => {
    expect(effectiveSource("referido")).toEqual({
      value: "referido",
      source: "capturada",
    });
  });

  it("sin captura queda desconocida, y se dice que fue deducida", () => {
    // No se inventa: un contacto que solo escribió por WhatsApp no dice de
    // dónde salió, y presentarlo como dato sería mentir en el reporte.
    expect(effectiveSource(null)).toEqual({
      value: "desconocida",
      source: "deducida",
    });
  });

  it("nunca inventa: 'desconocida' no es un valor capturable", () => {
    expect(isSourceValue("desconocida")).toBe(false);
    expect(SOURCE_VALUES).not.toContain("desconocida");
  });
});

describe("catálogo de fuentes", () => {
  it("es cerrado y cubre lo que el dueño pidió", () => {
    expect([...SOURCE_VALUES].sort()).toEqual(
      ["anuncio", "conocido", "organico", "otro", "referido"].sort()
    );
  });

  it("toda fuente tiene etiqueta legible, incluida la desconocida", () => {
    for (const v of [...SOURCE_VALUES, "desconocida" as const]) {
      expect(SOURCE_LABELS[v]).toBeTruthy();
    }
  });

  it("valida entradas basura", () => {
    expect(isSourceValue("facebook")).toBe(false);
    expect(isSourceValue(null)).toBe(false);
    expect(isSourceValue("referido")).toBe(true);
  });
});
