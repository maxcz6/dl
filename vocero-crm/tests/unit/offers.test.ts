import { describe, expect, it } from "vitest";
import {
  findOffered,
  sameInstant,
  type OfferedSlot,
} from "@/server/agenda/offers";

/**
 * 015 — La regla INNEGOCIABLE: solo se reserva lo que se ofreció, comparando
 * por instante EXACTO. Estos tests fijan lo que un LLM no puede saltarse.
 */

const OFFERS: OfferedSlot[] = [
  { startUtc: "2026-08-05T15:00:00.000Z", label: "mié 5 ago, 09:00" },
  { startUtc: "2026-08-05T15:30:00.000Z", label: "mié 5 ago, 09:30" },
  { startUtc: "2026-08-06T16:00:00.000Z", label: "jue 6 ago, 10:00" },
];

describe("findOffered", () => {
  it("acepta un instante ofrecido", () => {
    expect(findOffered(OFFERS, "2026-08-05T15:30:00.000Z")?.label).toBe(
      "mié 5 ago, 09:30"
    );
  });

  it("acepta el MISMO instante escrito con otro offset", () => {
    // 09:00 en México es el mismo instante que 15:00Z: es el mismo hueco.
    expect(findOffered(OFFERS, "2026-08-05T09:00:00.000-06:00")).not.toBeNull();
  });

  it("rechaza un instante que no se ofreció, aunque sea cercano", () => {
    // Un minuto de diferencia NO es el hueco ofrecido.
    expect(findOffered(OFFERS, "2026-08-05T15:31:00.000Z")).toBeNull();
    // Un horario perfectamente válido pero nunca ofrecido tampoco vale.
    expect(findOffered(OFFERS, "2026-08-05T18:00:00.000Z")).toBeNull();
  });

  it("rechaza basura sin lanzar (el modelo alucinó el formato)", () => {
    expect(findOffered(OFFERS, "el martes a las 10")).toBeNull();
    expect(findOffered(OFFERS, "")).toBeNull();
  });

  it("sin oferta previa no hay nada reservable", () => {
    expect(findOffered([], "2026-08-05T15:00:00.000Z")).toBeNull();
  });
});

describe("sameInstant", () => {
  it("compara instantes, no cadenas", () => {
    expect(
      sameInstant("2026-08-05T15:00:00.000Z", "2026-08-05T09:00:00-06:00")
    ).toBe(true);
    expect(
      sameInstant("2026-08-05T15:00:00.000Z", "2026-08-05T15:00:01.000Z")
    ).toBe(false);
  });

  it("una fecha inválida nunca es igual a nada", () => {
    expect(sameInstant("nope", "2026-08-05T15:00:00.000Z")).toBe(false);
  });
});
