import { describe, expect, it } from "vitest";
import {
  byPriority,
  isPriority,
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  priorityRank,
} from "@/server/leads/priority";

describe("prioridad del lead", () => {
  it("nada la escribe sola: no hay función que la sugiera", async () => {
    // Este test es el contrato del módulo. Si alguien agrega una heurística
    // que rellene la prioridad, el dueño dejará de poder confiar en que lo que
    // ve es lo que él puso — y este test es el lugar donde discutirlo.
    const mod = await import("@/server/leads/priority");
    expect(Object.keys(mod)).not.toContain("suggestPriority");
  });

  it("el catálogo es cerrado y todo valor tiene etiqueta", () => {
    expect([...PRIORITY_VALUES]).toEqual(["alta", "media", "baja"]);
    for (const p of PRIORITY_VALUES) expect(PRIORITY_LABELS[p]).toBeTruthy();
  });

  it("valida entradas basura", () => {
    expect(isPriority("alta")).toBe(true);
    expect(isPriority("ALTA")).toBe(false);
    expect(isPriority("urgente")).toBe(false);
    expect(isPriority(null)).toBe(false);
  });
});

describe("orden de trabajo", () => {
  it("alta primero, y lo que nadie priorizó va al final", () => {
    expect(priorityRank("alta")).toBeLessThan(priorityRank("media"));
    expect(priorityRank("media")).toBeLessThan(priorityRank("baja"));
    expect(priorityRank("baja")).toBeLessThan(priorityRank(null));
  });

  it("ordena una lista sin perder a nadie", () => {
    const leads = [
      { id: "sin", priority: null },
      { id: "baja", priority: "baja" as const },
      { id: "alta", priority: "alta" as const },
      { id: "media", priority: "media" as const },
    ];
    expect(byPriority(leads).map((l) => l.id)).toEqual([
      "alta",
      "media",
      "baja",
      "sin",
    ]);
    expect(byPriority(leads)).toHaveLength(leads.length);
  });

  it("no muta la lista que recibe", () => {
    const leads = [
      { priority: "baja" as const },
      { priority: "alta" as const },
    ];
    const copia = [...leads];
    byPriority(leads);
    expect(leads).toEqual(copia);
  });

  it("a igualdad de prioridad conserva el orden que traía", () => {
    const leads = [
      { id: "b", priority: "alta" as const },
      { id: "a", priority: "alta" as const },
    ];
    expect(byPriority(leads).map((l) => l.id)).toEqual(["b", "a"]);
  });
});
