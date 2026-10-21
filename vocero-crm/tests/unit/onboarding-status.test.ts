import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import type { EstadoIa } from "@/lib/ai/provider";

/**
 * #86 — Los pasos verificados de la guía de inicio, con la base falsa: cada
 * paso sale de la misma fuente que ya decide si esa pieza funciona (la fila
 * de Ajustes → IA o el entorno, el `status` de la conexión, el catálogo de
 * conectores), y lo que está MAL se dice en `problem`.
 */

const estadoIaDe = vi.hoisted(() => vi.fn<() => Promise<EstadoIa>>());
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  estadoIaDe,
}));

const getBrainHealth = vi.hoisted(() => vi.fn());
vi.mock("@/server/bot/status", () => ({ getBrainHealth }));

import { onboardingStatus } from "@/server/onboarding/status";
import { verifyCalendar, hasWeeklyHours } from "@/server/onboarding/calendar-verifiers";

// Identidades REALES de las tablas; solo se reemplaza el transporte.
const rows = new Map<unknown, unknown[]>();
const db = {
  select: () => ({
    from: (table: unknown) => {
      const query = {
        where: () => query,
        limit: () => query,
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows.get(table) ?? []).then(resolve),
      };
      return query;
    },
  }),
} as unknown as ReturnType<typeof getDb>;

const HORAS = { mon: [{ start: "09:00", end: "18:00" }] };
const paso = async (key: string) =>
  (await onboardingStatus("org_1", db)).steps.find((s) => s.key === key);

beforeEach(() => {
  rows.clear();
  vi.stubEnv("AGENDA", "");
  vi.stubEnv("BRAIN_DISPATCH_URL", "");
  vi.stubEnv("BRAIN_HEALTH_URL", "");
  getBrainHealth.mockReset();
  getBrainHealth.mockResolvedValue(null);
  estadoIaDe.mockResolvedValue({ activa: false, motivo: "sin_configurar" });
  rows.set(schema.agentProfile, [{ name: "Asistente", instructions: null, enabled: false }]);
});
afterEach(() => vi.unstubAllEnvs());

describe("una instancia recién instalada", () => {
  it("tiene los tres pasos pendientes, la agenda no aplica y el agente apagado", async () => {
    const status = await onboardingStatus("org_1", db);
    expect(status.enabled).toBe(false);
    expect(status.steps.map((s) => [s.key, s.status])).toEqual([
      ["profile", "pending"],
      ["ai", "pending"],
      ["whatsapp", "pending"],
      ["brain", "pending"],
      ["calendar", "not_applicable"],
    ]);
    expect(status.steps.find((s) => s.key === "calendar")?.href).toBeNull();
    // Lo pendiente de un paso recién instalado no es un «problema».
    expect(status.steps.every((s) => s.problem === null)).toBe(true);
  });

  it("cada paso lleva a su pantalla", async () => {
    const status = await onboardingStatus("org_1", db);
    expect(status.steps.map((s) => s.href)).toEqual([
      "/agent",
      "/settings/ai",
      "/settings/whatsapp",
      null,
      null,
    ]);
  });
});

describe("036 — «Conecta tu agente»", () => {
  const LLAVE = "k".repeat(32);

  it("sin BRAIN_DISPATCH_URL está pendiente y dice qué poner, sin «problema»", async () => {
    const s = await paso("brain");
    expect(s).toMatchObject({ status: "pending", problem: null });
    expect(s?.nextAction).toMatch(/BRAIN_DISPATCH_URL/);
    expect(getBrainHealth).not.toHaveBeenCalled();
  });

  it("sin BOT_API_KEY lo dice como problema", async () => {
    vi.stubEnv("BRAIN_DISPATCH_URL", "http://nea:8000/vocero/dispatch");
    vi.stubEnv("BOT_API_KEY", "");
    expect((await paso("brain"))?.problem).toMatch(/BOT_API_KEY/);
  });

  it("configurado y con el /health en línea → listo; le pregunta al /health del mismo origen", async () => {
    vi.stubEnv("BRAIN_DISPATCH_URL", "http://nea:8000/vocero/dispatch");
    vi.stubEnv("BOT_API_KEY", LLAVE);
    getBrainHealth.mockResolvedValue({ reachable: true, host: "nea:8000", checkedAt: "", version: "2.0.0" });
    const s = await paso("brain");
    expect(s).toMatchObject({ status: "ready", problem: null });
    expect(s?.nextAction).toContain("2.0.0");
    expect(getBrainHealth).toHaveBeenCalledWith("http://nea:8000/health");
  });

  it("configurado pero el /health no contesta → pendiente con el motivo", async () => {
    vi.stubEnv("BRAIN_DISPATCH_URL", "http://nea:8000/vocero/dispatch");
    vi.stubEnv("BOT_API_KEY", LLAVE);
    getBrainHealth.mockResolvedValue({ reachable: false, host: "nea:8000", checkedAt: "", problem: "network" });
    const s = await paso("brain");
    expect(s?.status).toBe("pending");
    expect(s?.problem).toMatch(/no responde/);
  });
});

describe("paso 1: el agente", () => {
  it("está listo con instrucciones, o con conocimiento aunque no haya instrucciones", async () => {
    rows.set(schema.agentProfile, [{ name: "Sofi", instructions: "Vende limpiezas.", enabled: false }]);
    expect((await paso("profile"))?.status).toBe("ready");

    rows.set(schema.agentProfile, [{ name: "Sofi", instructions: "   ", enabled: false }]);
    rows.set(schema.kbEntry, [{ id: "kb_1" }]);
    expect((await paso("profile"))?.status).toBe("ready");
  });

  it("el nombre de fábrica no basta: sin instrucciones ni conocimiento sigue pendiente y dice qué falta", async () => {
    const step = await paso("profile");
    expect(step?.status).toBe("pending");
    expect(step?.nextAction).toMatch(/nombre/);
  });

  it("`enabled` sale del mismo perfil", async () => {
    rows.set(schema.agentProfile, [{ name: "Sofi", instructions: "x", enabled: true }]);
    expect((await onboardingStatus("org_1", db)).enabled).toBe(true);
  });
});

describe("paso 2: el proveedor de IA (la fila manda, el entorno es respaldo)", () => {
  it("la llave guardada en Ajustes → IA lo deja listo", async () => {
    estadoIaDe.mockResolvedValue({ activa: true, origen: "org", last4: "abcd" });
    const step = await paso("ai");
    expect(step).toMatchObject({ status: "ready", problem: null });
    expect(step?.nextAction).toMatch(/Ajustes/);
  });

  it("sin fila, OPENROUTER_* del entorno también cuenta", async () => {
    estadoIaDe.mockResolvedValue({ activa: true, origen: "env", last4: "abcd" });
    const step = await paso("ai");
    expect(step?.status).toBe("ready");
    expect(step?.nextAction).toMatch(/entorno/);
  });

  it("una llave pausada NO está lista y el problema se dice (rechazada o sin saldo)", async () => {
    estadoIaDe.mockResolvedValue({
      activa: false,
      motivo: "token_invalido",
      last4: "abcd",
      desde: null,
    });
    const rechazada = await paso("ai");
    expect(rechazada?.status).toBe("pending");
    expect(rechazada?.problem).toMatch(/rechazó/);

    estadoIaDe.mockResolvedValue({
      activa: false,
      motivo: "sin_saldo",
      last4: "abcd",
      desde: null,
    });
    expect((await paso("ai"))?.problem).toMatch(/saldo/);
  });
});

describe("paso 3: WhatsApp", () => {
  it("conectado → listo", async () => {
    rows.set(schema.metaCredentials, [{ status: "connected" }]);
    expect(await paso("whatsapp")).toMatchObject({ status: "ready", problem: null });
  });

  it("token vencido → pendiente, y se dice que hay que reconectar", async () => {
    rows.set(schema.metaCredentials, [{ status: "reconnect_required" }]);
    const step = await paso("whatsapp");
    expect(step?.status).toBe("pending");
    expect(step?.problem).toMatch(/token/);
  });
});

describe("paso 4: la agenda, solo con AGENDA=on", () => {
  beforeEach(() => vi.stubEnv("AGENDA", "on"));

  it("sin horarios guardados está pendiente y lleva a Ajustes → Agenda", async () => {
    expect(await paso("calendar")).toMatchObject({
      status: "pending",
      href: "/settings/calendar",
      problem: null,
    });
  });

  it("enlace fijo con horarios → listo sin pedir credenciales de nadie", async () => {
    rows.set(schema.calendarSettings, [{ connector: "enlace-fijo", weeklyHours: HORAS }]);
    expect((await paso("calendar"))?.status).toBe("ready");
  });

  it("horarios vacíos (todos los días cerrados) → pendiente", async () => {
    rows.set(schema.calendarSettings, [{ connector: "enlace-fijo", weeklyHours: {} }]);
    expect((await paso("calendar"))?.status).toBe("pending");
  });

  it("un conector elegido sin credencial sigue pendiente y lo dice", async () => {
    rows.set(schema.calendarSettings, [{ connector: "zoom", weeklyHours: HORAS }]);
    const zoom = await paso("calendar");
    expect(zoom?.status).toBe("pending");
    expect(zoom?.problem).toMatch(/Zoom.*no está conectado/);

    rows.set(schema.calendarSettings, [{ connector: "google", weeklyHours: HORAS }]);
    expect((await paso("calendar"))?.problem).toMatch(/Google/);
  });

  it("con la credencial conectada → listo; rechazada por el proveedor → pendiente con el motivo", async () => {
    rows.set(schema.calendarSettings, [{ connector: "zoom", weeklyHours: HORAS }]);
    rows.set(schema.zoomCredentials, [{ status: "connected" }]);
    expect((await paso("calendar"))?.status).toBe("ready");

    rows.set(schema.zoomCredentials, [{ status: "error" }]);
    const roto = await paso("calendar");
    expect(roto?.status).toBe("pending");
    expect(roto?.problem).toMatch(/rechazó/);

    rows.set(schema.calendarSettings, [{ connector: "google", weeklyHours: HORAS }]);
    rows.set(schema.googleCredentials, [{ status: "connected" }]);
    expect((await paso("calendar"))?.status).toBe("ready");
  });

  it("un conector que no existe en esta instancia (venías de un fork) → unsupported", async () => {
    rows.set(schema.calendarSettings, [{ connector: "calendly", weeklyHours: HORAS }]);
    const step = await paso("calendar");
    expect(step?.status).toBe("unsupported");
    expect(step?.problem).toMatch(/calendly/);
  });
});

describe("verifyCalendar (pura)", () => {
  it("reconoce horarios bien formados y descarta los rotos", () => {
    expect(hasWeeklyHours(HORAS)).toBe(true);
    expect(hasWeeklyHours({ mon: [{ start: "18:00", end: "09:00" }] })).toBe(false);
    expect(hasWeeklyHours({ mon: [{ start: "9:00", end: "18:00" }] })).toBe(false);
    expect(hasWeeklyHours({ mon: [] })).toBe(false);
    expect(hasWeeklyHours(null)).toBe(false);
    expect(hasWeeklyHours("lunes")).toBe(false);
  });

  it("la tabla de decisión", () => {
    expect(verifyCalendar(undefined)).toBe("pending");
    expect(verifyCalendar({ connector: "enlace-fijo", weeklyHours: HORAS })).toBe("ready");
    expect(verifyCalendar({ connector: "zoom", weeklyHours: HORAS })).toBe("pending");
    expect(
      verifyCalendar({ connector: "zoom", weeklyHours: HORAS }, { zoom: true, google: false })
    ).toBe("ready");
    expect(
      verifyCalendar({ connector: "google", weeklyHours: HORAS }, { zoom: true, google: false })
    ).toBe("pending");
    expect(verifyCalendar({ connector: "otro", weeklyHours: HORAS })).toBe("unsupported");
    // Sin horarios manda lo pendiente, aunque el conector sea desconocido.
    expect(verifyCalendar({ connector: "otro", weeklyHours: {} })).toBe("pending");
  });
});
