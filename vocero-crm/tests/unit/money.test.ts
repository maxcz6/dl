import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  CURRENCY_GROUPS,
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  formatMoneyCents,
  isCurrency,
  parseMoneyToCents,
  sumable,
} from "@/lib/money";

describe("parseMoneyToCents", () => {
  it("acepta lo que la gente teclea de verdad", () => {
    expect(parseMoneyToCents("12500")).toBe(1_250_000);
    expect(parseMoneyToCents("12,500")).toBe(1_250_000);
    expect(parseMoneyToCents("12,500.50")).toBe(1_250_050);
    expect(parseMoneyToCents("$12 500.50")).toBe(1_250_050);
    expect(parseMoneyToCents("  900  ")).toBe(90_000);
  });

  it("un decimal solo no se confunde con millares", () => {
    // "12.5" son doce cincuenta, no doce mil quinientos.
    expect(parseMoneyToCents("12.5")).toBe(1_250);
    expect(parseMoneyToCents("12,5")).toBe(1_250);
  });

  it("trata el punto de millares como millares, no como decimales", () => {
    // "12.500" con tres dígitos detrás es doce mil quinientos.
    expect(parseMoneyToCents("12.500")).toBe(1_250_000);
  });

  it("sin número reconocible devuelve null, no cero", () => {
    // Un 0 se leería como "este trato no vale nada", que es un dato distinto
    // de "nadie capturó el monto".
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
    expect(parseMoneyToCents("$")).toBeNull();
    expect(parseMoneyToCents("no sé")).toBeNull();
  });

  it("el cero explícito sí es un cero", () => {
    expect(parseMoneyToCents("0")).toBe(0);
  });
});

describe("sumable", () => {
  it("solo suma lo que está en la moneda del negocio", () => {
    expect(sumable({ amountCents: 1000, currency: "MXN" }, "MXN")).toBe(true);
    expect(sumable({ amountCents: 1000, currency: "USD" }, "MXN")).toBe(false);
  });

  it("un monto sin moneda se asume en la del negocio", () => {
    // Es el caso de los leads capturados antes de que existiera la columna.
    expect(sumable({ amountCents: 1000, currency: null }, "MXN")).toBe(true);
  });

  it("sin monto no suma, aunque la moneda coincida", () => {
    expect(sumable({ amountCents: null, currency: "MXN" }, "MXN")).toBe(false);
  });

  it("cambiar la moneda del negocio cambia lo sumable", () => {
    const monto = { amountCents: 1000, currency: "USD" };
    expect(sumable(monto, "MXN")).toBe(false);
    expect(sumable(monto, "USD")).toBe(true);
  });
});

describe("formatMoneyCents", () => {
  it("formatea en la moneda pedida", () => {
    const out = formatMoneyCents(1_250_050, "MXN");
    expect(out).toContain("12,500.50");
  });

  it("null entra, null sale: no inventa un $0.00", () => {
    expect(formatMoneyCents(null, "MXN")).toBeNull();
    expect(formatMoneyCents(undefined, "MXN")).toBeNull();
  });

  it("una moneda que el runtime no conoce degrada sin romper la pantalla", () => {
    const out = formatMoneyCents(1_000, "XXX_INVALIDA");
    expect(out).toBe("10.00 XXX_INVALIDA");
  });
});

describe("catálogo de monedas", () => {
  it("valida entradas basura", () => {
    expect(isCurrency("MXN")).toBe(true);
    expect(isCurrency("mxn")).toBe(false);
    expect(isCurrency("pesos")).toBe(false);
    expect(isCurrency(null)).toBe(false);
  });

  it("cubre los países hispanohablantes y ninguna moneda se repite", () => {
    for (const code of ["MXN", "GTQ", "HNL", "NIO", "CRC", "PAB", "DOP", "COP", "VES", "PEN", "BOB", "CLP", "ARS", "UYU", "PYG", "BRL", "USD", "EUR"]) {
      expect(isCurrency(code), code).toBe(true);
    }
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
  });

  it("la predeterminada existe y ningún grupo del selector queda vacío", () => {
    expect(isCurrency(DEFAULT_CURRENCY)).toBe(true);
    for (const g of CURRENCY_GROUPS) {
      expect(CURRENCY_OPTIONS.some((c) => c.group === g.id), g.id).toBe(true);
    }
  });

  it("cada moneda tiene grupo y el runtime sabe formatearla", () => {
    const groups = new Set<string>(CURRENCY_GROUPS.map((g) => g.id));
    for (const c of CURRENCY_OPTIONS) {
      expect(groups.has(c.group), c.code).toBe(true);
      // Sin símbolo significaría que Intl no conoce el código: caería al
      // «1500.00 XXX» de emergencia.
      expect(formatMoneyCents(150_000, c.code), c.code).not.toMatch(new RegExp(`\\d ${c.code}$`));
    }
  });
});
