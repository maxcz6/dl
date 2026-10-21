import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_BASE_URL = "https://app.ejemplo.test";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

const { daysApart, median, PeriodError, resolvePeriod } = await import(
  "@/server/analytics/period"
);
const { bucketsDelPeriodo } = await import("@/lib/analytics");
const { shortcuts } = await import("@/components/results/range-picker");

/**
 * 019 — Los periodos de la pantalla Resultados (portado de Vocero Cloud).
 *
 * Lo que se fija aquí es que los cortes caen en la zona del NEGOCIO: con
 * cortes en UTC, todo lo que pasa después de las 18:00 en México cae en el día
 * siguiente y el dueño compararía su lunes contra un lunes que no existe.
 */

const MX = "America/Mexico_City";

describe("resolvePeriod", () => {
  const ahora = new Date("2026-03-15T18:00:00Z");

  it("sin fechas, son los últimos 30 días terminando hoy", () => {
    const p = resolvePeriod({ timezone: MX, now: ahora });
    expect(p.dto.to).toBe("2026-03-15");
    expect(p.dto.from).toBe("2026-02-14");
    expect(p.dto.days).toBe(30);
  });

  it("'hoy' es el del negocio: las 20:00 del 5 en México siguen siendo el 5", () => {
    // 2026-03-06T02:00Z ya es día 6 en UTC.
    const p = resolvePeriod({ timezone: MX, now: new Date("2026-03-06T02:00:00Z") });
    expect(p.dto.to).toBe("2026-03-05");
  });

  it("el periodo anterior dura LO MISMO y termina justo antes", () => {
    // Si no, la comparación mezclaría un mes de 30 días con uno de 31 y el
    // "+8 %" de la pantalla sería un artefacto del calendario.
    const p = resolvePeriod({ from: "2026-03-01", to: "2026-03-10", timezone: MX });
    expect(p.dto.days).toBe(10);
    expect(p.dto.previousTo).toBe("2026-02-28");
    expect(p.dto.previousFrom).toBe("2026-02-19");
  });

  it("el fin es EXCLUSIVO: arranca el día siguiente", () => {
    const p = resolvePeriod({ from: "2026-03-01", to: "2026-03-01", timezone: MX });
    expect(p.dto.days).toBe(1);
    expect(p.end.getTime() - p.start.getTime()).toBe(86_400_000);
  });

  it("los cortes son medianoche en la zona del negocio, no en UTC", () => {
    const p = resolvePeriod({ from: "2026-03-01", to: "2026-03-01", timezone: MX });
    // Medianoche del 1 de marzo en México (UTC-6) son las 06:00Z.
    expect(p.start.toISOString()).toBe("2026-03-01T06:00:00.000Z");
  });

  it("un día con cambio de horario dura lo que dura en la zona", () => {
    // Nueva York adelanta el reloj el 8 de marzo de 2026: ese día tiene 23 h.
    const p = resolvePeriod({
      from: "2026-03-08",
      to: "2026-03-08",
      timezone: "America/New_York",
    });
    expect(p.end.getTime() - p.start.getTime()).toBe(23 * 3_600_000);
  });

  it("el anterior termina EXACTAMENTE donde empieza el actual, sin hueco", () => {
    const p = resolvePeriod({ from: "2026-03-01", to: "2026-03-10", timezone: MX });
    expect(p.previousEnd.getTime()).toBe(p.start.getTime());
  });

  it("pasados 92 días agrupa por mes", () => {
    const corto = resolvePeriod({ from: "2026-01-01", to: "2026-04-02", timezone: MX });
    expect(corto.dto.days).toBe(92);
    expect(corto.dto.granularity).toBe("day");

    const largo = resolvePeriod({ from: "2026-01-01", to: "2026-04-03", timezone: MX });
    expect(largo.dto.granularity).toBe("month");
  });

  it("rechaza el rango invertido", () => {
    expect(() =>
      resolvePeriod({ from: "2026-03-10", to: "2026-03-01", timezone: MX })
    ).toThrow(PeriodError);
  });

  it("rechaza más de 366 días", () => {
    expect(() =>
      resolvePeriod({ from: "2024-01-01", to: "2026-01-01", timezone: MX })
    ).toThrow(PeriodError);
  });

  it("rechaza una fecha con formato inventado o que no existe", () => {
    // Llega de la barra de direcciones: tiene que ser un 422 con mensaje, no
    // un NaN que se propague hasta una consulta.
    expect(() => resolvePeriod({ from: "ayer", to: "2026-03-01", timezone: MX })).toThrow(
      PeriodError
    );
    expect(() =>
      resolvePeriod({ from: "2026-02-31", to: "2026-03-01", timezone: MX })
    ).toThrow(PeriodError);
  });

  it("una zona horaria inválida no tumba la pantalla", () => {
    const p = resolvePeriod({ from: "2026-03-01", to: "2026-03-02", timezone: "Marte/Olimpo" });
    expect(p.timezone).toBe("America/Mexico_City");
  });
});

describe("daysApart", () => {
  it("cuenta bien un año bisiesto y no se descuadra con el horario de verano", () => {
    expect(daysApart("2028-02-01", "2028-03-01")).toBe(29);
    expect(daysApart("2026-04-01", "2026-04-30")).toBe(29);
  });
});

describe("bucketsDelPeriodo", () => {
  it("un día sin movimientos es una cubeta en cero, no un hueco", () => {
    expect(
      bucketsDelPeriodo({ from: "2026-02-27", to: "2026-03-02", granularity: "day" })
    ).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("por mes, cruzando el año", () => {
    expect(
      bucketsDelPeriodo({ from: "2025-11-15", to: "2026-02-03", granularity: "month" })
    ).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("el rango más largo cabe entero", () => {
    const p = resolvePeriod({ from: "2025-01-01", to: "2026-01-01", timezone: MX });
    expect(bucketsDelPeriodo(p.dto)).toHaveLength(13);
  });
});

describe("atajos del rango", () => {
  it("se calculan sobre el hoy del negocio, en fechas de calendario", () => {
    const a = Object.fromEntries(shortcuts("2026-03-15").map((s) => [s.label, s.range]));
    expect(a["7 días"]).toEqual({ from: "2026-03-09", to: "2026-03-15" });
    expect(a["30 días"]).toEqual({ from: "2026-02-14", to: "2026-03-15" });
    expect(a["Este mes"]).toEqual({ from: "2026-03-01", to: "2026-03-15" });
    // Marzo: el mes pasado es un febrero de 28 días.
    expect(a["Mes pasado"]).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("en enero, el mes pasado es diciembre del año anterior", () => {
    const a = Object.fromEntries(shortcuts("2026-01-05").map((s) => [s.label, s.range]));
    expect(a["Mes pasado"]).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("'30 días' coincide con el periodo por defecto del servidor", () => {
    const hoy = "2026-03-15";
    const servidor = resolvePeriod({ timezone: MX, now: new Date("2026-03-15T18:00:00Z") });
    const cliente = shortcuts(hoy).find((s) => s.label === "30 días")!.range;
    expect(cliente).toEqual({ from: servidor.dto.from, to: servidor.dto.to });
  });
});

describe("median", () => {
  it("con lista vacía es null, no cero", () => {
    // Cero significaría "contestó al instante"; null significa "no hubo nada
    // que medir". La pantalla los dice distinto.
    expect(median([])).toBeNull();
  });

  it("impar toma el de en medio; par promedia los dos centrales", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
  });

  it("un valor extremo no la arrastra", () => {
    expect(median([2, 3, 4, 5, 100_000])).toBe(4);
  });
});
