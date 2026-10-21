import { describe, expect, it } from "vitest";
import {
  buildCandidateSlots,
  filterFreeSlots,
} from "@/server/agenda/availability";
import {
  DEFAULT_CALENDAR_SETTINGS,
  normalizeWeeklyHours,
  type CalendarSettings,
} from "@/server/agenda/settings";
import { daysWithAgenda, spreadByDay } from "@/server/agenda/spread";

/** 015 — El motor: horario − ocupado, con aviso mínimo. Sin BD ni reloj real. */

const MX = "America/Mexico_City";

function settings(over: Partial<CalendarSettings> = {}): CalendarSettings {
  return { ...DEFAULT_CALENDAR_SETTINGS, ...over };
}

describe("buildCandidateSlots", () => {
  it("solo genera slots en los días con horario (L-V por defecto)", () => {
    // 2026-08-08 es sábado; 2026-08-10 lunes.
    const slots = buildCandidateSlots(settings(), "2026-08-08", "2026-08-10");
    const días = new Set(slots.map((s) => s.startUtc.slice(0, 10)));
    expect(días.has("2026-08-08")).toBe(false); // sábado cerrado
    expect(días.has("2026-08-09")).toBe(false); // domingo cerrado
    expect(días.size).toBeGreaterThan(0); // el lunes sí
  });

  it("respeta la duración configurada", () => {
    const cortos = buildCandidateSlots(
      settings({ slotMinutes: 30 }),
      "2026-08-05",
      "2026-08-05"
    );
    const largos = buildCandidateSlots(
      settings({ slotMinutes: 60 }),
      "2026-08-05",
      "2026-08-05"
    );
    // 09:00-18:00 ⇒ 18 slots de 30 min, 9 de 60.
    expect(cortos).toHaveLength(18);
    expect(largos).toHaveLength(9);
  });

  it("un horario vacío no genera nada (negocio sin configurar días)", () => {
    expect(
      buildCandidateSlots(
        settings({ weeklyHours: {} }),
        "2026-08-03",
        "2026-08-07"
      )
    ).toEqual([]);
  });
});

describe("filterFreeSlots", () => {
  const tz = MX;
  const candidates = buildCandidateSlots(
    settings(),
    "2026-08-05",
    "2026-08-05"
  );

  it("descarta lo que no cumple el aviso mínimo", () => {
    // "Ahora" son las 09:00 locales del mismo día, con 2 h de aviso ⇒ el
    // primer hueco ofrecible es a las 11:00 locales (17:00Z).
    const now = new Date("2026-08-05T15:00:00.000Z");
    const free = filterFreeSlots(candidates, [], {
      now,
      minNoticeHours: 2,
      timezone: tz,
    });
    expect(free[0]!.startUtc).toBe("2026-08-05T17:00:00.000Z");
  });

  it("sin aviso mínimo ofrece desde el instante actual", () => {
    const now = new Date("2026-08-05T15:00:00.000Z");
    const free = filterFreeSlots(candidates, [], {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    expect(free[0]!.startUtc).toBe("2026-08-05T15:00:00.000Z");
  });

  it("una cita ocupada retira su hueco y solo ese", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const ocupado = [
      {
        startUtc: "2026-08-05T16:00:00.000Z",
        endUtc: "2026-08-05T16:30:00.000Z",
      },
    ];
    const libres = filterFreeSlots(candidates, ocupado, {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    const inicios = libres.map((s) => s.startUtc);
    expect(inicios).not.toContain("2026-08-05T16:00:00.000Z");
    expect(inicios).toContain("2026-08-05T16:30:00.000Z");
    expect(inicios).toContain("2026-08-05T15:30:00.000Z");
  });

  it("un bloqueo largo retira todos los huecos que toca", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const bloqueo = [
      {
        startUtc: "2026-08-05T15:00:00.000Z",
        endUtc: "2026-08-05T17:00:00.000Z", // 2 h ⇒ 4 slots de 30
      },
    ];
    const libres = filterFreeSlots(candidates, bloqueo, {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    expect(libres).toHaveLength(candidates.length - 4);
  });

  it("devuelve los huecos ordenados y etiquetados", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const libres = filterFreeSlots([...candidates].reverse(), [], {
      now,
      minNoticeHours: 0,
      timezone: tz,
    });
    const tiempos = libres.map((s) => Date.parse(s.startUtc));
    expect([...tiempos].sort((a, b) => a - b)).toEqual(tiempos);
    expect(libres[0]!.label).toContain("09:00");
  });

  it("agenda llena ⇒ lista vacía, no error", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const todo = candidates.map((c) => ({
      startUtc: c.startUtc,
      endUtc: c.endUtc,
    }));
    expect(
      filterFreeSlots(candidates, todo, {
        now,
        minNoticeHours: 0,
        timezone: tz,
      })
    ).toEqual([]);
  });
});

/**
 * Sin reparto, los primeros huecos se los come el día de hoy y quien ofrece se
 * queda sin nada que decir cuando el lead pide otro día.
 */
describe("spreadByDay", () => {
  // 14:00Z son las 08:00 en México: "hoy" es el miércoles 5, no la víspera.
  // (Con 00:00Z el día local del negocio sería todavía el 4 — el motor decide
  // el día en la zona del negocio, no en la del servidor.)
  const now = new Date("2026-08-05T14:00:00.000Z");
  // Mié 5 a vie 7 de agosto, 09:00-18:00, citas de 30 ⇒ 18 huecos por día.
  const libres = filterFreeSlots(
    buildCandidateSlots(settings(), "2026-08-05", "2026-08-07"),
    [],
    { now, minNoticeHours: 0, timezone: MX }
  );

  it("toma como mucho `perDay` de cada día, en vez de los N más próximos", () => {
    const spread = spreadByDay(libres, {
      timezone: MX,
      limit: 12,
      perDay: 3,
      now,
    });
    expect(spread).toHaveLength(9); // 3 días × 3
    expect(daysWithAgenda(spread)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("el límite corta el total sin romper el reparto", () => {
    const spread = spreadByDay(libres, {
      timezone: MX,
      limit: 4,
      perDay: 3,
      now,
    });
    expect(spread).toHaveLength(4);
    // 3 del primer día + 1 del segundo: el límite no se come la variedad.
    expect(daysWithAgenda(spread)).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("cada hueco viaja con su día EN PALABRAS y su hora", () => {
    const spread = spreadByDay(libres, {
      timezone: MX,
      limit: 3,
      perDay: 1,
      now,
    });
    expect(spread[0]!.dayLabel).toMatch(/^hoy /);
    expect(spread[1]!.dayLabel).toMatch(/^mañana /);
    expect(spread[0]!.time).toBe("09:00");
  });

  it("sin huecos no inventa días", () => {
    expect(
      spreadByDay([], { timezone: MX, limit: 12, perDay: 3, now })
    ).toEqual([]);
  });
});

describe("normalizeWeeklyHours", () => {
  it("descarta intervalos inválidos sin tumbar el resto del horario", () => {
    const out = normalizeWeeklyHours({
      mon: [
        { start: "09:00", end: "18:00" },
        { start: "20:00", end: "19:00" }, // fin antes del inicio
        { start: "9:00", end: "18:00" }, // formato inválido
      ],
      tue: [],
    });
    expect(out.mon).toEqual([{ start: "09:00", end: "18:00" }]);
    expect(out.tue).toBeUndefined(); // día sin franjas válidas = cerrado
  });

  it("ordena las franjas por hora de inicio", () => {
    const out = normalizeWeeklyHours({
      wed: [
        { start: "16:00", end: "18:00" },
        { start: "09:00", end: "13:00" },
      ],
    });
    expect(out.wed?.[0]?.start).toBe("09:00");
  });
});
