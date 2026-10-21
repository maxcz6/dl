import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 015 — El sandbox del Laboratorio en la agenda.
 *
 * Una cita de una conversación de prueba se registra, pero JAMÁS llega a un
 * conector: nadie crea una reunión de Zoom ni un evento en el calendario del
 * dueño por una simulación.
 *
 * Se prueba aquí y no en el arnés E2E por una razón concreta: las
 * conversaciones del Laboratorio no son alcanzables desde la API pública (a
 * propósito), así que no hay forma de conducirlas desde fuera. Este test sí
 * puede afirmar lo que importa —que el conector no se llama— en vez de
 * observarlo por ausencia.
 *
 * En el fork del que salió este motor la protección es ASIMÉTRICA: existe al
 * crear y está cableada a `false` al reprogramar y cancelar. Ahí no rompe nada
 * de milagro; aquí se comprueban las tres.
 */

const settings = {
  weeklyHours: { wed: [{ start: "09:00", end: "18:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "zoom" as const,
  meetingLink: null,
};

const SLOT = "2026-08-05T15:00:00.000Z";

const createMeeting = vi.fn(async () => ({
  externalId: "zoom_1",
  joinUrl: "https://zoom.test/j/1",
}));
const updateMeeting = vi.fn(async () => {});
const deleteMeeting = vi.fn(async () => {});
const bindConnector = vi.fn(async () => ({
  id: "zoom",
  createMeeting,
  updateMeeting,
  deleteMeeting,
  testConnection: async () => ({ ok: true }),
}));

vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => settings }));
vi.mock("@/server/agenda/availability", () => ({
  findSlot: async () => ({ startUtc: SLOT, endUtc: "…", label: "mié 5 ago, 09:00" }),
  computeAvailability: async () => [],
}));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: async () => [{ startUtc: SLOT, label: "mié 5 ago, 09:00" }],
    replaceOffers: async () => {},
    clearOffers: async () => {},
  };
});
vi.mock("@/server/agenda/connectors", () => ({
  bindConnector,
  markConnectorAuthError: async () => {},
}));
vi.mock("@/server/leads/stage-history", () => ({
  moveLeadToStage: async () => ({ ok: true }),
}));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));

const selectRows: unknown[][] = [];
let lastInsert: Record<string, unknown> | null = null;
/** La fila que devuelve un `update(...).returning()`. */
let updatedRow: Record<string, unknown> = {};

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectRows.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          lastInsert = v;
          return Promise.resolve([
            { ...v, scheduledAt: new Date(SLOT), externalRef: null, linkPending: false },
          ]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...updatedRow, ...v }]),
        }),
      }),
    }),
  }),
  schema: {
    booking: {},
    conversation: { organizationId: "organizationId", id: "id" },
    contact: { organizationId: "organizationId", id: "id", name: "name" },
    lead: { organizationId: "organizationId", contactId: "contactId" },
    pipelineStage: { organizationId: "organizationId" },
    offeredSlot: {},
  },
}));

const CITA_DE_PRUEBA = {
  id: "bk_test",
  organizationId: "org_1",
  scheduledAt: new Date(SLOT),
  durationMinutes: 30,
  status: "agendada",
  isTest: true,
  connector: "zoom",
  // Aunque tuviera reunión, no debe tocarse: es de prueba.
  externalRef: "zoom_viejo",
  meetingLink: null,
  linkPending: false,
  notes: null,
  contactId: "ct_1",
};

describe("una cita del Laboratorio jamás llega al proveedor", () => {
  beforeEach(() => {
    selectRows.length = 0;
    lastInsert = null;
    updatedRow = { ...CITA_DE_PRUEBA };
    createMeeting.mockClear();
    updateMeeting.mockClear();
    deleteMeeting.mockClear();
    bindConnector.mockClear();
  });

  it("al CREAR: la cita se registra como de prueba y no se crea reunión", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    selectRows.push([{ contactId: "ct_1", isTest: true }]); // la conversación
    selectRows.push([{ name: "Persona simulada" }]); // el contacto
    selectRows.push([]); // sin lead

    const result = await createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_lab",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
    });

    expect(lastInsert?.isTest).toBe(true);
    expect(result.booking.isTest).toBe(true);
    // Lo que importa: ni siquiera se resolvió el conector.
    expect(bindConnector).not.toHaveBeenCalled();
    expect(createMeeting).not.toHaveBeenCalled();
  });

  it("al REPROGRAMAR: no se mueve nada en el proveedor", async () => {
    const { rescheduleBooking } = await import("@/server/agenda/service");
    selectRows.push([CITA_DE_PRUEBA]);

    await rescheduleBooking({
      organizationId: "org_1",
      bookingId: "bk_test",
      startUtc: SLOT,
    });

    expect(updateMeeting).not.toHaveBeenCalled();
    expect(bindConnector).not.toHaveBeenCalled();
  });

  it("al CANCELAR: no se borra nada en el proveedor", async () => {
    const { cancelBooking } = await import("@/server/agenda/service");
    selectRows.push([CITA_DE_PRUEBA]);

    await cancelBooking({ organizationId: "org_1", bookingId: "bk_test" });

    expect(deleteMeeting).not.toHaveBeenCalled();
    expect(bindConnector).not.toHaveBeenCalled();
  });

  it("una cita REAL sí llega al proveedor (el guardarraíl no apaga todo)", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    selectRows.push([{ contactId: "ct_1", isTest: false }]);
    selectRows.push([{ name: "Cliente real" }]);
    selectRows.push([]);

    await createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_real",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
    });

    expect(createMeeting).toHaveBeenCalledOnce();
  });
});
