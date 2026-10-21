import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  citasEnContexto,
  citasParaContexto,
  type FilaCita,
} from "@/server/agenda/context";

/**
 * 015 — Las citas del contacto en el contexto de un cerebro externo
 * (`GET /api/bot/context` → `booking`).
 *
 * Nea pega este bloque tal cual en su prompt y lo trata como LA verdad sobre
 * las citas (`_booking_lines`): sin él, en la edición cloud, reservó una
 * segunda cita a quien no llegó a la primera, dijo a las 17:04 que la demo era
 * «hoy a las 10:30» y negó con un motivo inventado una cita que el equipo
 * había cancelado. Por eso la forma importa tanto como el contenido: la de la
 * edición cloud, para que un mismo cerebro sirva contra las dos.
 */

const TZ = "America/Mexico_City";
const DIA = 86_400_000;

// Lunes 14 de septiembre de 2026, 10:30 en CDMX (UTC-6).
const LUNES_1030 = new Date("2026-09-14T16:30:00.000Z");
// 17:04 del mismo lunes: la hora a la que el agente dijo «tu demo es hoy a las 10:30».
const LUNES_1704 = new Date("2026-09-14T23:04:00.000Z");

function cita(extra: Partial<FilaCita> = {}): FilaCita {
  return {
    id: "bk_1",
    kind: "session",
    status: "agendada",
    isTest: false,
    scheduledAt: LUNES_1030,
    durationMinutes: 30,
    meetingLink: "https://meet.google.com/aza-iftw-wxp",
    linkPending: false,
    updatedAt: new Date("2026-09-10T12:00:00.000Z"),
    ...extra,
  };
}

describe("la forma de una cita en el contexto", () => {
  it("la etiqueta dice el DÍA en palabras, relativo a ahora, en la zona del negocio", () => {
    // Con la corta («lun 14 sep, 10:30») un modelo no tiene cómo saber que
    // esa cita es la de hoy.
    const antes = new Date("2026-09-14T15:00:00.000Z"); // 09:00 del mismo lunes
    expect(citasEnContexto([cita()], TZ, antes).next?.label).toBe(
      "hoy lunes, 14 de septiembre, 10:30"
    );
    const domingo = new Date("2026-09-13T18:00:00.000Z");
    expect(citasEnContexto([cita()], TZ, domingo).next?.label).toMatch(/^mañana lunes/);
  });

  it("trae id, estado, inicio y fin en UTC, enlace y si está pendiente", () => {
    const { next } = citasEnContexto([cita()], TZ, new Date("2026-09-14T15:00:00.000Z"));
    expect(next).toEqual({
      id: "bk_1",
      status: "agendada",
      startUtc: "2026-09-14T16:30:00.000Z",
      endUtc: "2026-09-14T17:00:00.000Z",
      label: "hoy lunes, 14 de septiembre, 10:30",
      meetingLink: "https://meet.google.com/aza-iftw-wxp",
      linkPending: false,
    });
  });

  it("con el enlace pendiente lo dice, en vez de prometer uno", () => {
    const { next } = citasEnContexto(
      [cita({ meetingLink: null, linkPending: true })],
      TZ,
      new Date("2026-09-14T15:00:00.000Z")
    );
    expect(next).toMatchObject({ meetingLink: null, linkPending: true });
  });

  it("siempre dice en qué zona están las etiquetas", () => {
    expect(citasEnContexto([], TZ, LUNES_1704).timezone).toBe(TZ);
  });
});

describe("qué citas salen", () => {
  it("sin citas, el bloque existe con las tres vacías (la agenda SÍ se consultó)", () => {
    expect(citasEnContexto([], TZ, LUNES_1704)).toEqual({
      timezone: TZ,
      next: null,
      unresolved: null,
      lastClosed: null,
    });
  });

  it("`next` es la agendada más próxima, no la última creada", () => {
    const martes = cita({ id: "bk_martes", scheduledAt: new Date("2026-09-15T16:30:00.000Z") });
    const jueves = cita({ id: "bk_jueves", scheduledAt: new Date("2026-09-17T16:30:00.000Z") });
    const { next } = citasEnContexto([jueves, martes], TZ, LUNES_1704);
    expect(next?.id).toBe("bk_martes");
  });

  it("una cita que ya empezó y nadie cerró NO es la próxima: va en `unresolved`", () => {
    // El caso de las 17:04: darla por vigente es decir «tu demo es hoy a las 10:30».
    const r = citasEnContexto([cita()], TZ, LUNES_1704);
    expect(r.next).toBeNull();
    expect(r.unresolved?.id).toBe("bk_1");
    expect(r.unresolved?.endUtc).toBe("2026-09-14T17:00:00.000Z");
  });

  it("una sin cerrar de hace más de 7 días ya no es tema de conversación", () => {
    const vieja = cita({ scheduledAt: new Date(LUNES_1704.getTime() - 8 * DIA) });
    expect(citasEnContexto([vieja], TZ, LUNES_1704).unresolved).toBeNull();
  });

  it("una cancelada no es la próxima aunque sea futura: va en `lastClosed`", () => {
    const cancelada = cita({
      status: "cancelada",
      scheduledAt: new Date("2026-09-15T16:30:00.000Z"),
      updatedAt: new Date("2026-09-14T22:00:00.000Z"),
    });
    const r = citasEnContexto([cancelada], TZ, LUNES_1704);
    expect(r.next).toBeNull();
    expect(r.lastClosed).toMatchObject({
      id: "bk_1",
      status: "cancelada",
      closedAt: "2026-09-14T22:00:00.000Z",
      // En la raíz solo el equipo cancela: por /api/bot/* no existe cancelar.
      cancelledBy: "equipo",
    });
  });

  it("`lastClosed` es la cerrada MÁS RECIENTE, y no lleva enlace: ya no sirve", () => {
    const realizada = cita({
      id: "bk_realizada",
      status: "realizada",
      scheduledAt: new Date("2026-09-11T16:30:00.000Z"),
      updatedAt: new Date("2026-09-11T18:00:00.000Z"),
    });
    const noShow = cita({
      id: "bk_no_show",
      status: "no_show",
      scheduledAt: new Date("2026-09-12T16:30:00.000Z"),
      updatedAt: new Date("2026-09-13T09:00:00.000Z"),
    });
    const { lastClosed } = citasEnContexto([realizada, noShow], TZ, LUNES_1704);
    expect(lastClosed?.id).toBe("bk_no_show");
    expect(lastClosed?.cancelledBy).toBeNull();
    expect(lastClosed).not.toHaveProperty("meetingLink");
    expect(lastClosed).not.toHaveProperty("linkPending");
  });

  it("una cerrada hace más de 7 días ya no sale", () => {
    const vieja = cita({
      status: "cancelada",
      updatedAt: new Date(LUNES_1704.getTime() - 8 * DIA),
    });
    expect(citasEnContexto([vieja], TZ, LUNES_1704).lastClosed).toBeNull();
  });

  it("una cita de PRUEBA jamás aparece, ni siendo la mejor candidata de cada bloque", () => {
    // Del Laboratorio: es de un cliente simulado. Presentarla como real le
    // haría al cerebro negar una cita nueva o defender una que no existe.
    const prueba = (extra: Partial<FilaCita>) => cita({ isTest: true, ...extra });
    const r = citasEnContexto(
      [
        prueba({ id: "t_next", scheduledAt: new Date("2026-09-15T16:30:00.000Z") }),
        prueba({ id: "t_unresolved", scheduledAt: LUNES_1030 }),
        prueba({ id: "t_closed", status: "cancelada", updatedAt: LUNES_1704 }),
      ],
      TZ,
      LUNES_1704
    );
    expect(r).toEqual({ timezone: TZ, next: null, unresolved: null, lastClosed: null });
  });

  it("un bloqueo del operador no es una cita de nadie", () => {
    const bloqueo = cita({ kind: "block", scheduledAt: new Date("2026-09-15T16:30:00.000Z") });
    expect(citasEnContexto([bloqueo], TZ, LUNES_1704).next).toBeNull();
  });
});

/* -------- citasParaContexto: la bandera y la degradación -------- */

// `vi.hoisted`: el módulo bajo prueba se importa arriba, y el mock tiene que
// existir antes de que ese import resuelva `@/lib/db`.
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});

vi.mock("@/server/agenda/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/settings")>();
  return {
    ...original,
    getSettings: vi.fn(async () => ({
      ...original.DEFAULT_CALENDAR_SETTINGS,
      timezone: "America/Bogota",
    })),
  };
});

/** Una base cuyo `select … from … where` devuelve `rows` (o revienta). */
function baseCon(rows: FilaCita[] | Error) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)).then(resolve, reject);
  return { select: () => chain };
}

describe("citasParaContexto", () => {
  beforeEach(() => {
    getDb.mockReset();
  });

  it("con la agenda APAGADA no hay bloque, y ni se toca la base", async () => {
    vi.stubEnv("AGENDA", "");
    await expect(citasParaContexto("org_1", "ct_1")).resolves.toBeNull();
    expect(getDb).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("encendida, elige sobre lo que lee y etiqueta en la zona configurada", async () => {
    vi.stubEnv("AGENDA", "on");
    getDb.mockReturnValue(
      baseCon([
        cita({ id: "bk_prueba", isTest: true, scheduledAt: new Date("2026-09-15T15:00:00.000Z") }),
        cita({ id: "bk_real", scheduledAt: new Date("2026-09-16T15:00:00.000Z") }),
      ])
    );
    const r = await citasParaContexto("org_1", "ct_1", LUNES_1704);
    expect(r?.timezone).toBe("America/Bogota");
    expect(r?.next?.id).toBe("bk_real");
    // 15:00Z es 10:00 en Bogotá (UTC-5).
    expect(r?.next?.label).toBe("miércoles, 16 de septiembre, 10:00");
    vi.unstubAllEnvs();
  });

  it("si la lectura falla, no hay bloque — y el contexto no se cae por eso", async () => {
    vi.stubEnv("AGENDA", "on");
    getDb.mockReturnValue(baseCon(new Error("conexión perdida")));
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(citasParaContexto("org_1", "ct_1", LUNES_1704)).resolves.toBeNull();
    expect(consola).toHaveBeenCalled();
    consola.mockRestore();
    vi.unstubAllEnvs();
  });
});
