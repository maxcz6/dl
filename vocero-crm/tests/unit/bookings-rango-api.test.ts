import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 215 (raíz) — `GET /api/bookings?from=&to=` de punta a punta hasta la BD
 * (falsa): el rango se corta a la medianoche del NEGOCIO, pasa por `scoped()`,
 * ya no se queda en las últimas 200 (fallo 4), avisa si toca el tope de
 * seguridad, y SIN parámetros responde exactamente lo de siempre, que es lo
 * que lee el guion E2E de 015.
 */

const SETTINGS = {
  weeklyHours: { mon: [{ start: "09:00", end: "18:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 14,
  timezone: "America/Mexico_City",
  connector: "enlace-fijo" as const,
  meetingLink: "https://meet.ejemplo.com/sala",
};

type Call = { method: string; args: unknown[] };
const state = vi.hoisted(() => ({
  agendaOn: true,
  calls: [] as { method: string; args: unknown[] }[],
  rows: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_a", role: "owner" }),
  getSessionOrNull: async () => ({ userId: "usr_1", organizationId: "org_a", role: "owner" }),
}));

vi.mock("@/server/agenda/flag", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/flag")>();
  return { ...original, agendaEnabled: () => state.agendaOn };
});

vi.mock("@/server/agenda/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/settings")>();
  return { ...original, getSettings: async () => SETTINGS };
});

// El tenant y los límites del rango, legibles en la prueba.
vi.mock("@/lib/db/tenant", () => ({
  scoped: (_col: unknown, organizationId: string, ...conditions: unknown[]) => ({
    organizationId,
    conditions,
  }),
}));
vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...original,
    gte: (_col: unknown, value: unknown) => ({ op: "gte", value }),
    lt: (_col: unknown, value: unknown) => ({ op: "lt", value }),
    asc: () => "asc",
    desc: () => "desc",
  };
});

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  const builder = () => {
    const b: Record<string, (...args: unknown[]) => unknown> = {};
    for (const m of ["select", "from", "leftJoin", "where", "orderBy"]) {
      b[m] = (...args: unknown[]) => {
        state.calls.push({ method: m, args });
        return b;
      };
    }
    b.limit = (n: unknown) => {
      state.calls.push({ method: "limit", args: [n] });
      return Promise.resolve(state.rows.slice(0, Number(n)));
    };
    return b;
  };
  return { ...original, getDb: () => builder() };
});

const { GET } = await import("@/app/api/bookings/route");
const { RANGE_LIMIT } = await import("@/server/agenda/queries");

function row(id: string, startIso: string, durationMinutes = 30) {
  return {
    booking: {
      id,
      organizationId: "org_a",
      kind: "session",
      status: "agendada",
      source: "ai",
      scheduledAt: new Date(startIso),
      durationMinutes,
      contactId: "ct_1",
      conversationId: "cv_1",
      connector: "enlace-fijo",
      meetingLink: "https://meet.ejemplo.com/sala",
      linkPending: false,
      isTest: false,
      notes: null,
    },
    contactId: "ct_1",
    contactName: "María",
  };
}

const call = (method: string): Call | undefined => state.calls.find((c) => c.method === method);

async function get(query = "") {
  const res = await GET(new Request(`http://localhost/api/bookings${query}`));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeEach(() => {
  state.agendaOn = true;
  state.calls = [];
  state.rows = [];
});

describe("GET /api/bookings sin parámetros: la respuesta de siempre", () => {
  it("solo `bookings`, las últimas 200 en orden descendente", async () => {
    state.rows = Array.from({ length: 250 }, (_, i) =>
      row(`bk_${i}`, new Date(Date.UTC(2026, 8, 21, 15) - i * 3_600_000).toISOString())
    );
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["bookings"]);
    expect(body.bookings).toHaveLength(200);
    expect(call("limit")?.args).toEqual([200]);
    expect(call("orderBy")?.args).toEqual(["desc"]);
    const where = call("where")?.args[0] as { organizationId: string; conditions: unknown[] };
    expect(where).toEqual({ organizationId: "org_a", conditions: [] });
  });

  it("cada cita trae la hora en la zona del negocio, como antes", async () => {
    state.rows = [row("bk_1", "2026-09-24T21:00:00.000Z")];
    const { body } = await get();
    const [b] = body.bookings as Record<string, unknown>[];
    expect(b).toMatchObject({
      id: "bk_1",
      scheduledAtUtc: "2026-09-24T21:00:00.000Z",
      time: "15:00",
      contact: { id: "ct_1", name: "María" },
      isTest: false,
    });
  });
});

describe("GET /api/bookings?from=&to=: el rango del calendario", () => {
  it("corta a la medianoche del negocio (mirando 24 h atrás) y pasa por el tenant", async () => {
    const { status, body } = await get("?from=2026-09-21&to=2026-09-27");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      bookings: [],
      timezone: "America/Mexico_City",
      weeklyHours: SETTINGS.weeklyHours,
      range: { from: "2026-09-21", to: "2026-09-27" },
      truncated: false,
    });
    const where = call("where")?.args[0] as {
      organizationId: string;
      conditions: { op: string; value: Date }[];
    };
    expect(where.organizationId).toBe("org_a");
    // 00:00 del lunes 21 en CDMX = 06:00Z; se mira desde 24 h antes.
    expect(where.conditions[0]).toEqual({ op: "gte", value: new Date("2026-09-20T06:00:00.000Z") });
    // Hasta la medianoche del lunes 28 en CDMX, exclusiva.
    expect(where.conditions[1]).toEqual({ op: "lt", value: new Date("2026-09-28T06:00:00.000Z") });
    expect(call("orderBy")?.args).toEqual(["asc"]);
  });

  it("fallo 4: más de 200 citas en el rango llegan todas", async () => {
    state.rows = Array.from({ length: 450 }, (_, i) =>
      row(`bk_${i}`, new Date(Date.UTC(2026, 8, 21, 14) + i * 30 * 60_000).toISOString())
    );
    const { body } = await get("?from=2026-09-21&to=2026-10-31");
    expect(body.bookings).toHaveLength(450);
    expect(body.truncated).toBe(false);
    expect(call("limit")?.args).toEqual([RANGE_LIMIT]);
  });

  it("si toca el tope de seguridad lo dice en vez de esconder citas", async () => {
    state.rows = Array.from({ length: RANGE_LIMIT + 5 }, (_, i) =>
      row(`bk_${i}`, new Date(Date.UTC(2026, 8, 21, 14) + i * 15 * 60_000).toISOString(), 15)
    );
    const { body } = await get("?from=2026-09-21&to=2026-12-21");
    expect(body.bookings).toHaveLength(RANGE_LIMIT);
    expect(body.truncated).toBe(true);
  });

  it("de lo que empezó el día anterior, solo lo que sigue ocupando el rango", async () => {
    state.rows = [
      // Terminó el domingo 20 a las 23:00 de CDMX: no toca el lunes.
      row("bk_ayer", "2026-09-21T04:00:00.000Z", 60),
      // Bloqueo nocturno del domingo 22:00 a 02:00 del lunes: sí lo toca.
      row("bk_nocturno", "2026-09-21T04:00:00.000Z", 240),
      row("bk_lunes", "2026-09-21T16:00:00.000Z"),
    ];
    const { body } = await get("?from=2026-09-21&to=2026-09-21");
    expect((body.bookings as { id: string }[]).map((b) => b.id)).toEqual([
      "bk_nocturno",
      "bk_lunes",
    ]);
  });

  it.each([
    ["solo from", "?from=2026-09-21"],
    ["solo to", "?to=2026-09-21"],
    ["fecha que no existe", "?from=2026-02-31&to=2026-03-02"],
    ["formato raro", "?from=21-09-2026&to=2026-09-27"],
    ["al revés", "?from=2026-09-27&to=2026-09-21"],
    ["93 días", "?from=2026-09-01&to=2026-12-02"],
  ])("rango inválido (%s) → 422 invalid_range sin tocar la BD", async (_name, query) => {
    const { status, body } = await get(query);
    expect(status).toBe(422);
    expect((body.error as { code: string }).code).toBe("invalid_range");
    expect(state.calls).toHaveLength(0);
  });

  it("92 días exactos sí caben", async () => {
    const { status } = await get("?from=2026-09-01&to=2026-12-01");
    expect(status).toBe(200);
  });

  it("con la agenda apagada es 404, aunque el rango venga mal", async () => {
    state.agendaOn = false;
    expect((await get("?from=2026-09-21&to=2026-09-27")).status).toBe(404);
    expect((await get("?from=mal")).status).toBe(404);
    expect((await get()).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
});
