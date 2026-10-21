import { describe, expect, it } from "vitest";
import {
  countVariables,
  renderBody,
  validateBodyVariables,
} from "@/server/whatsapp/templates";

describe("countVariables / validateBodyVariables (FR-050)", () => {
  it("sin variables → 0, válido", () => {
    expect(countVariables("Hola, seguimos disponibles.")).toBe(0);
    expect(validateBodyVariables("Hola, seguimos disponibles.")).toBeNull();
  });

  it("una variable {{1}} → 1, válido (con y sin espacios)", () => {
    expect(countVariables("Hola {{1}}, ¿retomamos?")).toBe(1);
    expect(countVariables("Hola {{ 1 }}, ¿retomamos?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿retomamos?")).toBeNull();
  });

  it("varias variables numeradas en orden → válido", () => {
    const body = "Hola {{1}}, te confirmo el {{2}} a las {{3}}.";
    expect(countVariables(body)).toBe(3);
    expect(validateBodyVariables(body)).toBeNull();
  });

  it("la variable repetida cuenta una sola vez", () => {
    expect(countVariables("Hola {{1}}, ¿confirmas, {{1}}?")).toBe(1);
    expect(validateBodyVariables("Hola {{1}}, ¿confirmas, {{1}}?")).toBeNull();
  });

  it("numeración con salto → inválida", () => {
    expect(validateBodyVariables("Hola {{1}}, tu pedido {{3}} llegó")).toMatch(
      /sin saltos/
    );
  });

  it("variable {{2}} sola → inválida (debe empezar en {{1}})", () => {
    expect(validateBodyVariables("Tu pedido {{2}} llegó")).toMatch(/\{\{1\}\}/);
  });

  it("más de 10 variables → inválida", () => {
    const body = Array.from({ length: 11 }, (_, i) => `x {{${i + 1}}}`).join(" ");
    expect(validateBodyVariables(body)).toMatch(/hasta 10/);
  });
});

describe("renderBody", () => {
  it("sustituye la variable por el valor", () => {
    expect(renderBody("Hola {{1}}, ¿retomamos?", ["María"])).toBe(
      "Hola María, ¿retomamos?"
    );
  });

  it("sustituye cada variable por su posición", () => {
    expect(
      renderBody("Hola {{1}}, te espero el {{2}} a las {{3}}.", [
        "María",
        "12 de agosto",
        "5 pm",
      ])
    ).toBe("Hola María, te espero el 12 de agosto a las 5 pm.");
  });

  it("sin valores → variables vacías", () => {
    expect(renderBody("Hola {{1}}!")).toBe("Hola !");
    expect(renderBody("Hola {{1}} el {{2}}", ["María"])).toBe("Hola María el ");
  });
});
