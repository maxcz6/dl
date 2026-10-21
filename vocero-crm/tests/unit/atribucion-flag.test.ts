import { describe, expect, it } from "vitest";
import { parseAtribucionFlag } from "@/server/attribution/flag";

/**
 * 016 — La bandera de la atribución. El caso que importa es el DEFAULT: una
 * instancia que no la pidió no debe acabar guardando identificadores de clic
 * de Meta ni mandándole eventos por un despiste de configuración.
 */

describe("parseAtribucionFlag", () => {
  it("sin variable, la atribución no existe", () => {
    expect(parseAtribucionFlag(undefined)).toBe(false);
    expect(parseAtribucionFlag("")).toBe(false);
    expect(parseAtribucionFlag("   ")).toBe(false);
  });

  it("`on` la enciende, con espacios y mayúsculas de por medio", () => {
    expect(parseAtribucionFlag("on")).toBe(true);
    expect(parseAtribucionFlag("ON")).toBe(true);
    expect(parseAtribucionFlag("  On  ")).toBe(true);
  });

  it("acepta las otras formas de decir que sí", () => {
    expect(parseAtribucionFlag("1")).toBe(true);
    expect(parseAtribucionFlag("true")).toBe(true);
    expect(parseAtribucionFlag("si")).toBe(true);
    expect(parseAtribucionFlag("sí")).toBe(true);
    expect(parseAtribucionFlag("yes")).toBe(true);
  });

  it("cualquier otra cosa la deja apagada, incluido `off` y `false`", () => {
    expect(parseAtribucionFlag("off")).toBe(false);
    expect(parseAtribucionFlag("false")).toBe(false);
    expect(parseAtribucionFlag("0")).toBe(false);
    expect(parseAtribucionFlag("no")).toBe(false);
    // Un typo no enciende nada: apagada es el estado seguro.
    expect(parseAtribucionFlag("onn")).toBe(false);
  });
});
