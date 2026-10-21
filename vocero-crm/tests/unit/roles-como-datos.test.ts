import { describe, expect, it } from "vitest";
import {
  CLAVES_HERRAMIENTA,
  HERRAMIENTAS,
  ROLES,
  herramientasEfectivas,
  rolDe,
} from "@/lib/agent-roles";
import { PERSONAS } from "@/server/lab/personas";
import { personasDelRol } from "@/server/lab/runner";

/** 034 — Roles como datos: el catálogo, el Calificador y sus personas. */
describe("el catálogo de herramientas", () => {
  it("las claves son contrato con el cerebro", () => {
    expect(CLAVES_HERRAMIENTA).toEqual(["ficha", "etapa", "agendar", "reprogramar", "salida", "escalar"]);
  });

  it("escalar es fija y las de agenda lo dicen", () => {
    expect(HERRAMIENTAS.filter((h) => h.fija).map((h) => h.clave)).toEqual(["escalar"]);
    expect(HERRAMIENTAS.filter((h) => h.agenda).map((h) => h.clave)).toEqual(["agendar", "reprogramar"]);
  });

  it("null = todas; una lista vacía deja solo escalar; el orden es el del catálogo", () => {
    expect(herramientasEfectivas(null)).toEqual([...CLAVES_HERRAMIENTA]);
    expect(herramientasEfectivas([])).toEqual(["escalar"]);
    expect(herramientasEfectivas(["salida", "ficha"])).toEqual(["ficha", "salida", "escalar"]);
  });
});

describe("el rol Calificador", () => {
  it("trae instrucciones, reglas de escalado y todas las herramientas", () => {
    const r = ROLES.calificador;
    expect(r.instrucciones.length).toBeGreaterThan(50);
    expect(r.reglasDeEscalado.length).toBeGreaterThan(20);
    expect([...r.herramientas]).toEqual([...CLAVES_HERRAMIENTA]);
  });

  it("sus personas existen todas en el Laboratorio", () => {
    expect(personasDelRol("calificador").map((p) => p.key)).toEqual([...ROLES.calificador.personas]);
    expect(personasDelRol("calificador")).toHaveLength(PERSONAS.length);
  });

  it("un rol desconocido cae al Calificador", () => {
    expect(rolDe("inventado").clave).toBe("calificador");
    expect(rolDe(null).clave).toBe("calificador");
  });
});
