import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  etapasSiguientes,
  moverEtapaPorElCerebro,
  resolverEtapa,
  type EtapaDelPipeline,
} from "@/server/bot/stage";

/** 038 — El cerebro mueve la etapa: reglas puras y decisión contra la BD. */

const dbState = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const movimientos = vi.hoisted(() => ({ llamadas: [] as unknown[], changed: true }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy"]) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(dbState.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});

vi.mock("@/server/leads/stage-history", () => ({
  moveLeadToStage: async (input: { leadId: string; toStageId: string }) => {
    movimientos.llamadas.push(input);
    return {
      ok: true,
      changed: movimientos.changed,
      lead: { id: input.leadId, contactId: "ct_1", stageId: input.toStageId },
    };
  },
}));

const PIPELINE: EtapaDelPipeline[] = [
  { id: "st_nuevo", name: "Nuevo", position: 0, kind: "open" },
  { id: "st_calif", name: "Calificado", position: 1, kind: "open" },
  { id: "st_cita", name: "Cita agendada", position: 2, kind: "open" },
  { id: "st_ganado", name: "Ganado", position: 3, kind: "won" },
  { id: "st_perdido", name: "Perdido", position: 4, kind: "lost" },
];

describe("etapasSiguientes", () => {
  it("las abiertas después de la actual, en orden, aunque lleguen revueltas", () => {
    const revuelto = [...PIPELINE].reverse();
    expect(etapasSiguientes(revuelto, "st_nuevo").map((s) => s.id)).toEqual(["st_calif", "st_cita"]);
  });

  it("vacía en la última abierta, en una de cierre o con una etapa que no existe", () => {
    expect(etapasSiguientes(PIPELINE, "st_cita")).toEqual([]);
    expect(etapasSiguientes(PIPELINE, "st_ganado")).toEqual([]);
    expect(etapasSiguientes(PIPELINE, "st_x")).toEqual([]);
  });
});

describe("resolverEtapa", () => {
  it("por id, por nombre exacto y sin mayúsculas ni espacios de los lados", () => {
    expect(resolverEtapa("st_cita", PIPELINE)?.id).toBe("st_cita");
    expect(resolverEtapa("Calificado", PIPELINE)?.id).toBe("st_calif");
    expect(resolverEtapa("  cita AGENDADA ", PIPELINE)?.id).toBe("st_cita");
  });

  it("null si no existe o viene vacía", () => {
    expect(resolverEtapa("Propuesta", PIPELINE)).toBeNull();
    expect(resolverEtapa("   ", PIPELINE)).toBeNull();
  });
});

describe("moverEtapaPorElCerebro", () => {
  const conv = { id: "cv_1", contactId: "ct_1", aiEnabled: true, handoffAt: null };
  const mover = (stage: string) =>
    moverEtapaPorElCerebro({ organizationId: "org_1", conversationId: "cv_1", stage });

  beforeEach(() => {
    dbState.queue = [];
    movimientos.llamadas = [];
    movimientos.changed = true;
  });

  /** conversación, perfil, lead, etapas — el orden en que se consultan. */
  function base(opts: { tools?: string[] | null; leadStage?: string | null; conversacion?: object } = {}) {
    dbState.queue.push(
      [{ ...conv, ...(opts.conversacion ?? {}) }],
      [{ tools: opts.tools ?? null }],
      opts.leadStage === null ? [] : [{ id: "ld_1", stageId: opts.leadStage ?? "st_nuevo" }],
      PIPELINE
    );
  }

  it("adelante a una abierta: mueve por la puerta única como bot", async () => {
    base();
    const res = await mover("calificado");
    expect(res).toEqual({
      ok: true,
      changed: true,
      lead: { id: "ld_1", stageName: "Calificado" },
      conversationId: "cv_1",
    });
    expect(movimientos.llamadas).toEqual([
      expect.objectContaining({ leadId: "ld_1", toStageId: "st_calif", source: "bot" }),
    ]);
  });

  it("la etapa actual es un reintento: pasa a la puerta, que contesta changed false", async () => {
    base({ leadStage: "st_calif" });
    movimientos.changed = false;
    const res = await mover("Calificado");
    expect(res.ok && res.changed).toBe(false);
  });

  it.each([
    ["hacia atrás", "Nuevo"],
    ["a ganada", "Ganado"],
    ["a perdida", "Perdido"],
  ])("%s: 409 etapa_no_permitida con las válidas en el mensaje", async (_c, etapa) => {
    base({ leadStage: "st_calif" });
    const res = await mover(etapa);
    expect(res).toMatchObject({ ok: false, status: 409, code: "etapa_no_permitida" });
    expect(!res.ok && res.message).toContain("Cita agendada");
    expect(movimientos.llamadas).toEqual([]);
  });

  it("una etapa que no existe: 422 etapa_desconocida", async () => {
    base();
    const res = await mover("Propuesta");
    expect(res).toMatchObject({ ok: false, status: 422, code: "etapa_desconocida" });
    expect(!res.ok && res.message).toContain("Calificado, Cita agendada");
  });

  it("con la herramienta apagada: 409 herramienta_apagada y no mueve", async () => {
    base({ tools: ["ficha", "salida"] });
    const res = await mover("Calificado");
    expect(res).toMatchObject({ ok: false, status: 409, code: "herramienta_apagada" });
    expect(movimientos.llamadas).toEqual([]);
  });

  it("con la herramienta en una lista explícita, sí mueve", async () => {
    base({ tools: ["etapa"] });
    expect((await mover("Calificado")).ok).toBe(true);
  });

  it("con una persona al frente: 409 ai_paused", async () => {
    base({ conversacion: { handoffAt: new Date() } });
    expect(await mover("Calificado")).toMatchObject({ status: 409, code: "ai_paused" });
    dbState.queue = [];
    base({ conversacion: { aiEnabled: false } });
    expect(await mover("Calificado")).toMatchObject({ status: 409, code: "ai_paused" });
  });

  it("sin conversación 404 not_found; sin lead 404 sin_lead", async () => {
    dbState.queue.push([]);
    expect(await mover("Calificado")).toMatchObject({ status: 404, code: "not_found" });
    base({ leadStage: null });
    expect(await mover("Calificado")).toMatchObject({ status: 404, code: "sin_lead" });
  });
});
