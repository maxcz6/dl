import { describe, expect, it } from "vitest";
import { SIN_DESPACHO, despachoFallando } from "@/lib/brain-status";
import { leerConfigDespacho } from "@/server/brains/config";
import { hayMensajesSinDespachar, sinDespachar } from "@/server/brains/deliver";
import { dispatchDto } from "@/server/dispatch/estado";
import { checkDispatch } from "@/server/doctor/checks";
import { BACKOFF_MS, MAX_INTENTOS, esperaDeReintento } from "@/server/dispatch/outbox";

/**
 * 021 — Cuándo hay despacho, y qué se dice cuando no.
 *
 * Lo que se protege: que una URL mal escrita o una llave ausente dejen el
 * despacho INACTIVO (y el agente incluido contestando como en 1.5) en vez de
 * una instancia muda, y que el motivo salga sin filtrar la ruta de la URL.
 */

const LLAVE = "k".repeat(32);

describe("leerConfigDespacho", () => {
  it("sin variable: inactivo y sin problema (la instancia no despacha)", () => {
    expect(leerConfigDespacho({})).toEqual({ active: false, host: null, problem: null });
    expect(leerConfigDespacho({ BRAIN_DISPATCH_URL: "   ", BOT_API_KEY: LLAVE })).toEqual({
      active: false,
      host: null,
      problem: null,
    });
  });

  it("URL interna + llave: activo, y es válida aunque no sea pública", () => {
    const c = leerConfigDespacho({
      BRAIN_DISPATCH_URL: "http://nea:8000/vocero/dispatch",
      BOT_API_KEY: LLAVE,
    });
    expect(c).toEqual({
      active: true,
      url: "http://nea:8000/vocero/dispatch",
      host: "nea:8000",
      secret: LLAVE,
    });
  });

  it("https público también", () => {
    const c = leerConfigDespacho({
      BRAIN_DISPATCH_URL: " https://nea.ejemplo.com/vocero/dispatch ",
      BOT_API_KEY: LLAVE,
    });
    expect(c.active).toBe(true);
    expect(c.host).toBe("nea.ejemplo.com");
  });

  it.each(["nea:8000/vocero/dispatch", "no es una url", "ftp://nea/vocero", "file:///etc/passwd"])(
    "%s → problema de URL, inactivo",
    (url) => {
      const c = leerConfigDespacho({ BRAIN_DISPATCH_URL: url, BOT_API_KEY: LLAVE });
      expect(c).toMatchObject({ active: false, problem: "url" });
    }
  );

  it("usuario y clave en la URL → problema de URL (el despacho ya va firmado)", () => {
    const c = leerConfigDespacho({
      BRAIN_DISPATCH_URL: "https://user:secreto@nea.ejemplo.com/vocero/dispatch",
      BOT_API_KEY: LLAVE,
    });
    expect(c).toEqual({ active: false, host: "nea.ejemplo.com", problem: "url" });
    expect(JSON.stringify(c)).not.toContain("secreto");
  });

  it("sin BOT_API_KEY, o corta → sin_llave, inactivo, y solo sale el host", () => {
    const sin = leerConfigDespacho({ BRAIN_DISPATCH_URL: "http://nea:8000/vocero/dispatch?t=abc" });
    expect(sin).toEqual({ active: false, host: "nea:8000", problem: "sin_llave" });
    const corta = leerConfigDespacho({
      BRAIN_DISPATCH_URL: "http://nea:8000/vocero/dispatch",
      BOT_API_KEY: "corta",
    });
    expect(corta).toMatchObject({ active: false, problem: "sin_llave" });
  });
});

describe("dispatchDto — lo que ve la tarjeta", () => {
  const activo = leerConfigDespacho({
    BRAIN_DISPATCH_URL: "http://nea:8000/vocero/dispatch",
    BOT_API_KEY: LLAVE,
  });
  const sinHechos = { lastDeliveredAt: null, lastFailure: null, pending: 0 };

  it("sin variable, es exactamente SIN_DESPACHO", () => {
    expect(dispatchDto(leerConfigDespacho({}), sinHechos)).toEqual(SIN_DESPACHO);
  });

  it("activo: host, fechas en ISO y jamás la llave ni la ruta", () => {
    const dto = dispatchDto(activo, {
      lastDeliveredAt: new Date("2026-10-08T10:00:00.000Z"),
      lastFailure: { at: new Date("2026-10-08T09:00:00.000Z"), detail: "el cerebro respondió 500" },
      pending: 2,
    });
    expect(dto).toEqual({
      active: true,
      host: "nea:8000",
      problem: null,
      lastDeliveredAt: "2026-10-08T10:00:00.000Z",
      lastFailure: { at: "2026-10-08T09:00:00.000Z", detail: "el cerebro respondió 500" },
      pending: 2,
    });
    expect(JSON.stringify(dto)).not.toContain(LLAVE);
    expect(JSON.stringify(dto)).not.toContain("/vocero/dispatch");
  });

  it("mal configurado: el problema viaja y active es false", () => {
    const dto = dispatchDto(leerConfigDespacho({ BRAIN_DISPATCH_URL: "http://nea:8000/x" }), sinHechos);
    expect(dto).toMatchObject({ active: false, host: "nea:8000", problem: "sin_llave" });
  });
});

describe("despachoFallando — cuándo es una alarma", () => {
  const base = { ...SIN_DESPACHO, active: true, host: "nea:8000" };
  const fallo = (at: string) => ({ at, detail: "el cerebro respondió 500" });

  it("sin fallos, o inactivo → no", () => {
    expect(despachoFallando(base)).toBe(false);
    expect(despachoFallando({ ...SIN_DESPACHO, lastFailure: fallo("2026-10-08T10:00:00.000Z") })).toBe(false);
  });

  it("falló y nunca ha entregado → sí", () => {
    expect(despachoFallando({ ...base, lastFailure: fallo("2026-10-08T10:00:00.000Z") })).toBe(true);
  });

  it("el fallo es posterior a la última entrega → sí; anterior → no", () => {
    const entregado = "2026-10-08T10:00:00.000Z";
    expect(
      despachoFallando({ ...base, lastDeliveredAt: entregado, lastFailure: fallo("2026-10-08T10:05:00.000Z") })
    ).toBe(true);
    expect(
      despachoFallando({ ...base, lastDeliveredAt: entregado, lastFailure: fallo("2026-10-08T09:55:00.000Z") })
    ).toBe(false);
  });
});

describe("reintentos", () => {
  it("tres intentos en total: se espera tras el primero y tras el segundo", () => {
    expect(MAX_INTENTOS).toBe(3);
    expect(BACKOFF_MS).toHaveLength(MAX_INTENTOS - 1);
    expect(esperaDeReintento(1)).toBe(1000);
    expect(esperaDeReintento(2)).toBe(4000);
  });

  it("un contador fuera de rango no revienta ni da una espera de cero", () => {
    expect(esperaDeReintento(0)).toBe(1000);
    expect(esperaDeReintento(99)).toBe(4000);
  });
});

describe("hayMensajesSinDespachar — lo que entró con el evento en vuelo", () => {
  it("la misma ráfaga → no", () => {
    expect(hayMensajesSinDespachar(["a", "b"], [{ id: "a" }, { id: "b" }])).toBe(false);
  });

  it("un mensaje más → sí", () => {
    expect(hayMensajesSinDespachar(["a", "b"], [{ id: "a" }, { id: "b" }, { id: "c" }])).toBe(true);
  });

  it("ráfaga vacía (ya se contestó) → no", () => {
    expect(hayMensajesSinDespachar(["a"], [])).toBe(false);
  });
});

/**
 * 025 — Cuáles, no solo si hay: son los ids que el despacho siguiente lleva
 * anotados en `dispatch.message_ids`.
 */
describe("sinDespachar — lo que el cerebro todavía no recibió", () => {
  it("devuelve los que faltan, en el orden de la ráfaga", () => {
    expect(sinDespachar(["a"], [{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual(["b", "c"]);
  });

  it("todo entregado → nada", () => {
    expect(sinDespachar(["a", "b"], [{ id: "a" }, { id: "b" }])).toEqual([]);
  });

  it("un debido que quedó detrás de la respuesta sigue debiéndose", () => {
    // `rafagaDe` lo trae por estar anotado, aunque la ráfaga ya esté cerrada.
    expect(sinDespachar(["a"], [{ id: "b" }])).toEqual(["b"]);
  });
});

describe("pnpm doctor — la línea del despacho", () => {
  it("sin la variable: se salta, no es un problema", () => {
    expect(checkDispatch({}).status).toBe("skip");
  });

  it("activo: ✓ con el host, sin la ruta ni la llave", () => {
    const r = checkDispatch({
      BRAIN_DISPATCH_URL: "http://nea:8000/vocero/dispatch?t=secreto",
      BOT_API_KEY: LLAVE,
    });
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("nea:8000");
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(JSON.stringify(r)).not.toContain(LLAVE);
  });

  it("mal puesta: aviso con el arreglo, nunca una ✗ (el CRM funciona igual)", () => {
    const url = checkDispatch({ BRAIN_DISPATCH_URL: "nea:8000", BOT_API_KEY: LLAVE });
    expect(url.status).toBe("warn");
    expect(url.fix).toContain("BRAIN_DISPATCH_URL=");
    const llave = checkDispatch({ BRAIN_DISPATCH_URL: "http://nea:8000/vocero/dispatch" });
    expect(llave.status).toBe("warn");
    expect(llave.fix).toContain("BOT_API_KEY=");
  });
});
