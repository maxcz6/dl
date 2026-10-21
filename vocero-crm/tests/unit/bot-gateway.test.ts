import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_API_BUDGET, BOT_AUTH_FAILURES, requireBotKey } from "@/server/bot/auth";
import { mergeFicha, normalizeFicha } from "@/server/bot/ficha";
import { toHandoffReason } from "@/server/bot/handoff";
import { resetRateLimit } from "@/lib/rate-limit";

/** La puerta de toda la superficie `/api/bot/*`. */

const KEY = "clave-de-servicio-larga-0123456789abcdef";

function reqWith(key?: string): Request {
  return new Request("http://localhost/api/bot/context", {
    headers: key ? { "x-api-key": key } : {},
  });
}

describe("requireBotKey", () => {
  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", KEY);
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("key correcta → pasa (null)", () => {
    expect(requireBotKey(reqWith(KEY))).toBeNull();
  });

  it("key incorrecta → 401", () => {
    const res = requireBotKey(reqWith("otra-clave-igual-de-larga-pero-mala!!"));
    expect(res?.status).toBe(401);
  });

  it("sin header → 401", () => {
    expect(requireBotKey(reqWith())?.status).toBe(401);
  });

  it("sin BOT_API_KEY configurada → 401 SIEMPRE (aunque manden algo)", () => {
    vi.stubEnv("BOT_API_KEY", "");
    expect(requireBotKey(reqWith("cualquier-cosa"))?.status).toBe(401);
  });

  it("key demasiado corta configurada → 401 (no se acepta una key débil)", () => {
    vi.stubEnv("BOT_API_KEY", "corta");
    expect(requireBotKey(reqWith("corta"))?.status).toBe(401);
  });

  it("longitudes distintas no filtran información (401 uniforme)", () => {
    const res = requireBotKey(reqWith("x"));
    expect(res?.status).toBe(401);
  });
});

/**
 * R11 — El límite ya no es un DoS de regalo. Antes: un cubo global contado
 * ANTES de autenticar, así que 600 requests anónimos por minuto dejaban al
 * cerebro en 429 y a los clientes sin respuesta.
 */
describe("requireBotKey: límites (autentica primero, cuenta después)", () => {
  const MALA = "clave-equivocada-del-mismo-largo-0000000";

  function desde(ip: string, key?: string): Request {
    return new Request("http://localhost/api/bot/context", {
      headers: {
        // Primer salto = el cliente; el resto lo agregan los proxies.
        "x-forwarded-for": `${ip}, 10.0.0.2`,
        ...(key ? { "x-api-key": key } : {}),
      },
    });
  }

  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", KEY);
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("700 requests sin key desde una IP → el cerebro sigue en 200", () => {
    const vistos = { 401: 0, 429: 0 };
    for (let i = 0; i < 700; i++) {
      const s = requireBotKey(desde("203.0.113.9", i % 2 ? MALA : undefined))?.status;
      if (s === 401 || s === 429) vistos[s]++;
    }
    expect(vistos).toEqual({ 401: BOT_AUTH_FAILURES.max, 429: 700 - BOT_AUTH_FAILURES.max });
    expect(requireBotKey(desde("198.51.100.7", KEY))).toBeNull();
    // Ni aunque comparta IP con quien inunda (mismo proxy, o "local").
    expect(requireBotKey(desde("203.0.113.9", KEY))).toBeNull();
  });

  it("las fallidas se frenan POR IP: 30 → 401, la 31 → 429; otra IP sigue en 401", () => {
    for (let i = 0; i < BOT_AUTH_FAILURES.max; i++) {
      expect(requireBotKey(desde("203.0.113.9", MALA))?.status).toBe(401);
    }
    expect(requireBotKey(desde("203.0.113.9", MALA))?.status).toBe(429);
    expect(requireBotKey(desde("192.0.2.1", MALA))?.status).toBe(401);
  });

  it("el presupuesto del cerebro autenticado sigue aplicando", () => {
    for (let i = 0; i < BOT_API_BUDGET.max; i++) {
      expect(requireBotKey(desde("198.51.100.7", KEY))).toBeNull();
    }
    expect(requireBotKey(desde("198.51.100.7", KEY))?.status).toBe(429);
    // Y los fallidos no se cuentan contra él: su respuesta sigue siendo 401.
    expect(requireBotKey(desde("192.0.2.1"))?.status).toBe(401);
  });
});

describe("normalizeFicha (tolerante al drift del LLM)", () => {
  it("las claves las pone el negocio, no el CRM", () => {
    expect(
      normalizeFicha({ tratamiento: "ortodoncia", metros: 120, urgente: true })
    ).toEqual({ tratamiento: "ortodoncia", metros: 120, urgente: true });
  });

  it("recorta espacios y trunca a 500 caracteres", () => {
    const out = normalizeFicha({ notas: "  hola  ", largo: "x".repeat(900) });
    expect(out.notas).toBe("hola");
    expect((out.largo as string).length).toBe(500);
  });

  it("la cadena vacía se descarta; null explícito sobrevive para borrar", () => {
    const out = normalizeFicha({ rubro: "", geo: null });
    expect("rubro" in out).toBe(false);
    expect(out.geo).toBeNull();
  });

  it("objetos y arreglos se ignoran sin reventar", () => {
    expect(normalizeFicha({ nested: { a: 1 }, lista: [1, 2], ok: "sí" })).toEqual({
      ok: "sí",
    });
  });

  it("números no finitos fuera; el cero sí es un dato", () => {
    expect(normalizeFicha({ a: Number.NaN, b: Infinity, empleados: 0 })).toEqual({
      empleados: 0,
    });
  });

  it("claves vacías o larguísimas se descartan", () => {
    const out = normalizeFicha({ "  ": "x", ["k".repeat(80)]: "y", bien: "z" });
    expect(out).toEqual({ bien: "z" });
  });

  it("un bot en bucle no puede inflar la ficha sin límite", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 200; i++) raw[`campo${i}`] = "v";
    expect(Object.keys(normalizeFicha(raw)).length).toBe(40);
  });
});

describe("toHandoffReason (el handoff nunca se pierde por el motivo)", () => {
  it("los motivos del catálogo pasan tal cual", () => {
    for (const r of ["cliente", "modelo", "error", "ventana", "hostilidad"]) {
      expect(toHandoffReason(r)).toBe(r);
    }
  });

  it("un motivo inventado por el LLM cae a 'modelo' en vez de tirar el handoff", () => {
    expect(toHandoffReason("porque el señor se enojó")).toBe("modelo");
  });

  it("ausente o vacío también cae a 'modelo'", () => {
    expect(toHandoffReason(undefined)).toBe("modelo");
    expect(toHandoffReason("   ")).toBe("modelo");
  });

  it("tolera mayúsculas y espacios de sobra", () => {
    expect(toHandoffReason("  Hostilidad ")).toBe("hostilidad");
  });
});

describe("mergeFicha", () => {
  it("lo ausente se conserva y lo nuevo se agrega", () => {
    expect(mergeFicha({ rubro: "dentista" }, { geo: "Querétaro" })).toEqual({
      rubro: "dentista",
      geo: "Querétaro",
    });
  });

  it("un valor nuevo pisa al viejo", () => {
    expect(mergeFicha({ geo: "CDMX" }, { geo: "Querétaro" })).toEqual({
      geo: "Querétaro",
    });
  });

  it("null borra la clave en vez de guardarla en null", () => {
    const out = mergeFicha({ rubro: "dentista", geo: "CDMX" }, { geo: null });
    expect(out).toEqual({ rubro: "dentista" });
  });

  it("sin ficha previa parte de cero", () => {
    expect(mergeFicha(null, { a: 1 })).toEqual({ a: 1 });
  });
});
