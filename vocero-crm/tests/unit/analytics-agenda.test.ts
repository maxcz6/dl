import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import { rate, type BotBlockDto } from "@/lib/analytics";
import { resolvePeriod } from "@/server/analytics/period";
import { botBlock } from "@/server/analytics/bot";
import { BotSection } from "@/components/results/bot-section";

/**
 * 019 — Con la bandera AGENDA apagada no hay citas en Resultados (spec 019,
 * D4): ni se consultan, ni viajan en la API, ni se pintan.
 *
 * La base es falsa y anota contra qué tabla corre cada consulta: así se prueba
 * que sin agenda la tabla `booking` ni siquiera se toca, no solo que el
 * resultado salga vacío.
 */

const db = vi.hoisted(() => ({ tablas: [] as unknown[] }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of [
    "select",
    "selectDistinctOn",
    "where",
    "innerJoin",
    "leftJoin",
    "groupBy",
    "orderBy",
    "limit",
  ]) {
    builder[m] = () => builder;
  }
  builder.from = (tabla: unknown) => {
    db.tablas.push(tabla);
    return builder;
  };
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve([]);
  return { ...actual, getDb: () => builder };
});

const periodo = resolvePeriod({
  from: "2026-03-01",
  to: "2026-03-31",
  timezone: "America/Mexico_City",
});

beforeEach(() => {
  db.tablas = [];
});

describe("botBlock y la bandera AGENDA", () => {
  it("apagada: `sessions` es null y la tabla de citas no se consulta", async () => {
    const b = await botBlock("org_1", periodo, false);
    expect(b.sessions).toBeNull();
    expect(db.tablas).not.toContain(schema.booking);
    // Lo demás del agente sigue ahí.
    expect(b.conversations).toBe(0);
    expect(b.empty).toBe(true);
  });

  it("encendida: cuenta las citas del periodo", async () => {
    const b = await botBlock("org_1", periodo, true);
    expect(b.sessions).toEqual({
      booked: 0,
      done: 0,
      noShow: 0,
      cancelled: 0,
      showRate: { value: null, sample: 0, reliable: false },
    });
    expect(db.tablas).toContain(schema.booking);
  });
});

describe("la sección del agente y la bandera AGENDA", () => {
  const datos: BotBlockDto = {
    period: periodo.dto,
    conversations: 12,
    aiReplyRate: rate(10, 11),
    firstResponseSeconds: 42,
    firstResponseSample: 10,
    handoffs: [{ key: "cliente", label: "El cliente pidió un humano", count: 2 }],
    handoffRate: rate(2, 12),
    sessions: { booked: 4, done: 2, noShow: 1, cancelled: 1, showRate: rate(2, 3) },
    fichaCoverage: null,
    empty: false,
  };
  const pintar = (agenda: boolean, data: BotBlockDto) =>
    renderToStaticMarkup(
      createElement(BotSection, { data, loading: false, error: null, agenda })
    );

  it("apagada no habla de citas, aunque llegaran datos", () => {
    const html = pintar(false, datos);
    expect(html).not.toMatch(/cita/i);
    expect(html).not.toContain("Asistencia");
    expect(html).toContain("Contestó el agente");
  });

  it("encendida enseña las citas del periodo", () => {
    const html = pintar(true, datos);
    expect(html).toContain("Citas del periodo");
    expect(html).toContain("Asistencia");
  });
});
