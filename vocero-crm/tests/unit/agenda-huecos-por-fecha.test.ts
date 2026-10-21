import { describe, expect, it } from "vitest";
import {
  buildCandidateSlots,
  filterFreeSlots,
  type AvailableSlot,
} from "@/server/agenda/availability";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarSettings,
} from "@/server/agenda/settings";
import {
  aLoLargoDelDia,
  armarHuecos,
  HUECOS_POR_FECHA,
  spreadByDay,
} from "@/server/agenda/spread";
import type { SlotUtc } from "@/lib/time/slots";

/**
 * Huecos por fecha, repartidos a lo largo del día, y hasta dónde llega lo
 * consultado.
 *
 * Fija el fallo de la prueba de punta a punta raíz + Nea: a «¿tienen algo
 * mañana en la tarde?» el agente ofreció 10:00, 10:30 y 11:00 y dijo que el
 * martes solo había mañana, con la agenda libre de 12:00 a 18:30. El CRM
 * ignoraba `date` y solo devolvía las tres primeras horas de cada día.
 */

const MX = "America/Mexico_City";
const NY = "America/New_York";
// Lunes 21 sep 2026, 09:00 en CDMX (UTC-6 todo el año desde 2022).
const NOW = new Date("2026-09-21T15:00:00.000Z");

const LUN_A_VIE: CalendarSettings["weeklyHours"] = {
  mon: [{ start: "10:00", end: "19:00" }],
  tue: [{ start: "10:00", end: "19:00" }],
  wed: [{ start: "10:00", end: "19:00" }],
  thu: [{ start: "10:00", end: "19:00" }],
  fri: [{ start: "10:00", end: "19:00" }],
};

function ajustes(over: Partial<CalendarSettings> = {}): CalendarSettings {
  return {
    ...DEFAULT_CALENDAR_SETTINGS,
    weeklyHours: LUN_A_VIE,
    minNoticeHours: 0,
    maxDaysAhead: 7,
    timezone: MX,
    ...over,
  };
}

/** Lo que devolvería el motor para [from, to] con `busy` ocupado. */
function libres(
  s: CalendarSettings,
  from: string,
  to: string,
  now: Date = NOW,
  busy: SlotUtc[] = []
): AvailableSlot[] {
  return filterFreeSlots(buildCandidateSlots(s, from, to), busy, {
    now,
    minNoticeHours: s.minNoticeHours,
    timezone: s.timezone,
  });
}

/** Una consulta por fecha, armada como la arma la ruta. */
function porFecha(
  s: CalendarSettings,
  date: string,
  now: Date = NOW,
  busy: SlotUtc[] = []
) {
  return armarHuecos({
    todos: libres(s, date, date, now, busy),
    timezone: s.timezone,
    now,
    maxDaysAhead: s.maxDaysAhead,
    limit: 12,
    perDay: 3,
    days: 5,
    date,
    candidatosDelDia: buildCandidateSlots(s, date, date).length,
  });
}

const horas = (slots: { time: string }[]) => slots.map((s) => s.time);

describe("«¿mañana en la tarde?» (el fallo de la prueba de punta a punta)", () => {
  const s = ajustes();

  it("el reparto de siempre solo ve la mañana de cada día… y ahora lo dice", () => {
    const { slots, query } = armarHuecos({
      todos: libres(s, "2026-09-21", "2026-09-28"),
      timezone: MX,
      now: NOW,
      maxDaysAhead: 7,
      limit: 12,
      perDay: 3,
      days: 5,
    });
    const manana = slots.filter((x) => x.dayIso === "2026-09-22");
    expect(horas(manana)).toEqual(["10:00", "10:30", "11:00"]);
    // 3 por día × 4 días = 12: el jueves 24 fue el último revisado.
    expect(query).toEqual({
      date: null,
      status: null,
      coveredUntil: "2026-09-24",
      horizonEnd: "2026-09-28",
      perDay: 3,
    });
  });

  it("con date trae TODO el martes, tarde incluida", () => {
    const { slots, query } = porFecha(s, "2026-09-22");
    expect(slots).toHaveLength(18); // 10:00 … 18:30, cada 30 min
    expect(horas(slots)).toEqual(
      expect.arrayContaining(["12:00", "15:00", "18:30"])
    );
    expect(slots.every((x) => x.dayIso === "2026-09-22")).toBe(true);
    expect(slots[0]!.dayLabel).toMatch(/^mañana martes/);
    expect(query).toEqual({
      date: "2026-09-22",
      status: "available",
      coveredUntil: "2026-09-22",
      horizonEnd: "2026-09-28",
      perDay: null,
    });
  });

  it("con date, limit/perDay/days no recortan el día", () => {
    const { slots } = armarHuecos({
      todos: libres(s, "2026-09-25", "2026-09-25"),
      timezone: MX,
      now: NOW,
      maxDaysAhead: 7,
      limit: 1,
      perDay: 1,
      days: 1, // el viernes 25 queda FUERA de una ventana de 1 día: no importa
      date: "2026-09-25",
      candidatosDelDia: 18,
    });
    expect(slots).toHaveLength(18);
  });

  it("no mezcla otros días aunque vengan en la lista", () => {
    const { slots } = armarHuecos({
      todos: libres(s, "2026-09-21", "2026-09-28"),
      timezone: MX,
      now: NOW,
      maxDaysAhead: 7,
      limit: 12,
      perDay: 3,
      date: "2026-09-23",
      candidatosDelDia: 18,
    });
    expect(slots).toHaveLength(18);
    expect(slots.every((x) => x.dayIso === "2026-09-23")).toBe(true);
  });
});

describe("repartidos a lo largo del día cuando no caben", () => {
  it("por debajo del tope, la lista tal cual", () => {
    const lista = [1, 2, 3];
    expect(aLoLargoDelDia(lista, 24)).toBe(lista);
  });

  it("por encima, del primero al último, sin repetir", () => {
    const lista = Array.from({ length: 40 }, (_, i) => i);
    const elegidos = aLoLargoDelDia(lista, 24);
    expect(elegidos).toHaveLength(24);
    expect(elegidos[0]).toBe(0);
    expect(elegidos[23]).toBe(39);
    for (let i = 1; i < elegidos.length; i++) {
      expect(elegidos[i]!).toBeGreaterThan(elegidos[i - 1]!);
    }
  });

  it("topes degenerados no revientan", () => {
    expect(aLoLargoDelDia([1, 2, 3], 1)).toEqual([1]);
    expect(aLoLargoDelDia([1, 2, 3], 0)).toEqual([]);
  });

  it("un día de 48 turnos no se queda en la mañana", () => {
    const s = ajustes({
      slotMinutes: 15,
      weeklyHours: { tue: [{ start: "08:00", end: "20:00" }] },
    });
    const { slots, query } = porFecha(s, "2026-09-22");
    expect(query.status).toBe("available");
    expect(slots).toHaveLength(HUECOS_POR_FECHA);
    expect(slots[0]!.time).toBe("08:00");
    expect(slots[slots.length - 1]!.time).toBe("19:45");
    expect(horas(slots).filter((h) => h >= "12:00").length).toBeGreaterThan(10);
  });
});

describe("por qué un día no tiene horas", () => {
  const s = ajustes();

  it("cerrado: ese día el negocio no abre", () => {
    const { slots, query } = porFecha(s, "2026-09-26"); // sábado
    expect(slots).toEqual([]);
    expect(query).toMatchObject({ status: "closed", coveredUntil: "2026-09-26" });
  });

  it("lleno: abre, pero ya no queda nada libre", () => {
    const todoElDia = { startUtc: "2026-09-22T16:00:00.000Z", endUtc: "2026-09-23T01:00:00.000Z" };
    const { slots, query } = porFecha(s, "2026-09-22", NOW, [todoElDia]);
    expect(slots).toEqual([]);
    expect(query.status).toBe("full");
  });

  it("lleno también cuando hoy ya cerró", () => {
    const tarde = new Date("2026-09-22T01:30:00.000Z"); // lun 21, 19:30 CDMX
    expect(porFecha(s, "2026-09-21", tarde).query.status).toBe("full");
  });

  it("un día que ya pasó se dice como tal", () => {
    expect(porFecha(s, "2026-09-20").query).toMatchObject({
      status: "past",
      coveredUntil: null,
    });
  });

  it("más allá del horizonte no es «lleno»: aún no se abre agenda", () => {
    const { slots, query } = porFecha(s, "2026-09-29"); // hoy + 8
    expect(slots).toEqual([]);
    expect(query).toMatchObject({
      status: "beyond_horizon",
      horizonEnd: "2026-09-28",
      coveredUntil: null,
    });
    // El último día del horizonte todavía se agenda.
    expect(porFecha(s, "2026-09-28").query.status).toBe("available");
  });
});

describe("la fecha es la del negocio, no la del servidor", () => {
  const s = ajustes();
  // Lunes 21, 22:30 en CDMX; en UTC ya es martes 22.
  const noche = new Date("2026-09-22T04:30:00.000Z");

  function consultas() {
    const hoy = porFecha(s, "2026-09-21", noche);
    const manana = porFecha(s, "2026-09-22", noche);
    return {
      hoy: hoy.query.status,
      manana: manana.query.status,
      horas: horas(manana.slots),
      dia: manana.slots[0]?.dayLabel,
      primero: manana.slots[0]?.startUtc,
      horizonte: manana.query.horizonEnd,
    };
  }

  it("«hoy» se decide en la zona del negocio", () => {
    const r = consultas();
    expect(r.hoy).toBe("full"); // el lunes sigue siendo hoy: no «past»
    expect(r.manana).toBe("available");
    expect(r.dia).toMatch(/^mañana martes/);
    expect(r.primero).toBe("2026-09-22T16:00:00.000Z"); // 10:00 CDMX
    expect(r.horizonte).toBe("2026-09-28");
  });

  it("da lo mismo con el proceso en otra zona horaria", () => {
    const esperado = consultas();
    const original = process.env.TZ;
    try {
      const offsets = {
        "Pacific/Kiritimati": -840, // UTC+14: ya es otro día casi siempre
        "Pacific/Pago_Pago": 660, // UTC-11
        "Asia/Tokyo": -540,
      };
      for (const [tz, offset] of Object.entries(offsets)) {
        process.env.TZ = tz;
        // Que el cambio de zona sí surtió efecto en este proceso.
        expect(new Date("2026-01-01T00:00:00Z").getTimezoneOffset()).toBe(offset);
        expect(consultas()).toEqual(esperado);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("horario de verano en la zona del negocio", () => {
  const diario = { start: "09:00", end: "18:00" };
  const s = ajustes({
    timezone: NY,
    weeklyHours: {
      mon: [diario], tue: [diario], wed: [diario], thu: [diario],
      fri: [diario], sat: [diario], sun: [diario],
    },
  });

  it("el día que se adelanta el reloj: 09:00 es 13:00Z, y son las 18 horas", () => {
    const now = new Date("2026-03-07T12:00:00.000Z");
    const antes = porFecha(s, "2026-03-07", now);
    const cambio = porFecha(s, "2026-03-08", now);
    expect(antes.slots[0]!.startUtc).toBe("2026-03-07T14:00:00.000Z"); // EST
    expect(cambio.slots[0]!.startUtc).toBe("2026-03-08T13:00:00.000Z"); // EDT
    expect(cambio.slots).toHaveLength(18);
    expect(cambio.slots[17]!.time).toBe("17:30");
    expect(cambio.slots.every((x) => x.dayIso === "2026-03-08")).toBe(true);
  });

  it("el día que se atrasa el reloj: 09:00 es 14:00Z", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    const cambio = porFecha(s, "2026-11-01", now);
    expect(cambio.slots[0]!.startUtc).toBe("2026-11-01T14:00:00.000Z"); // EST
    expect(cambio.slots).toHaveLength(18);
    expect(new Set(horas(cambio.slots)).size).toBe(18);
  });

  it("un hueco de noche cae en su día local aunque en UTC ya sea el siguiente", () => {
    const noche = ajustes({
      timezone: NY,
      weeklyHours: { sun: [{ start: "20:00", end: "23:30" }] },
    });
    const now = new Date("2026-03-07T12:00:00.000Z");
    const { slots, query } = porFecha(noche, "2026-03-08", now);
    expect(query.status).toBe("available");
    expect(horas(slots)).toEqual(["20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"]);
    expect(slots[slots.length - 1]!.startUtc).toBe("2026-03-09T03:00:00.000Z");
    expect(slots.every((x) => x.dayIso === "2026-03-08")).toBe(true);
  });
});

describe("sin date: el reparto de siempre, con cobertura", () => {
  const s = ajustes({ maxDaysAhead: 14 });
  const todos = libres(s, "2026-09-21", "2026-10-05");

  /** La ruta ANTES de R10: repartir y luego recortar a `days`. */
  function antes(limit: number, perDay: number, days: number): string[] {
    const hoy = Date.parse("2026-09-21T00:00:00Z");
    return spreadByDay(todos, { timezone: MX, limit, perDay, now: NOW })
      .filter((x) => {
        const diff = (Date.parse(`${x.dayIso}T00:00:00Z`) - hoy) / 86_400_000;
        return diff >= 0 && diff < days;
      })
      .map((x) => x.startUtc);
  }

  it.each([
    [12, 3, 5],
    [4, 3, 5],
    [48, 8, 14],
    [12, 3, 1],
    [12, 1, 2],
    [5, 2, 3],
  ])("limit=%i perDay=%i days=%i da los mismos huecos que antes", (limit, perDay, days) => {
    const { slots } = armarHuecos({
      todos,
      timezone: MX,
      now: NOW,
      maxDaysAhead: 14,
      limit,
      perDay,
      days,
    });
    expect(slots.map((x) => x.startUtc)).toEqual(antes(limit, perDay, days));
  });

  it("si no se llenó, se revisó toda la ventana", () => {
    // 2 días hábiles × 3 = 6 < 12: lo que falta en la ventana SÍ está cerrado.
    const { slots, query } = armarHuecos({
      todos,
      timezone: MX,
      now: NOW,
      maxDaysAhead: 14,
      limit: 12,
      perDay: 3,
      days: 2,
    });
    expect(slots).toHaveLength(6);
    expect(query.coveredUntil).toBe("2026-09-22");
  });

  it("una ventana más larga que el horizonte se queda en el horizonte", () => {
    const { query } = armarHuecos({
      todos: libres(ajustes(), "2026-09-21", "2026-09-28"),
      timezone: MX,
      now: NOW,
      maxDaysAhead: 7,
      limit: 48,
      perDay: 8,
      days: 14,
    });
    expect(query.coveredUntil).toBe("2026-09-28");
    expect(query.horizonEnd).toBe("2026-09-28");
  });

  it("sin huecos no inventa días y dice que revisó todo", () => {
    const { slots, query } = armarHuecos({
      todos: [],
      timezone: MX,
      now: NOW,
      maxDaysAhead: 7,
      limit: 12,
      perDay: 3,
      days: 5,
    });
    expect(slots).toEqual([]);
    expect(query.coveredUntil).toBe("2026-09-25");
  });
});
