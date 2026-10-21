import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardarraíl de la bitácora de etapas.
 *
 * Mover un lead y registrar el movimiento son la misma operación. Si un camino
 * nuevo escribe `lead.stage_id` por su cuenta, nada truena: simplemente el
 * historial nace con un hueco y las gráficas mienten meses después, cuando ya
 * no hay forma de reconstruirlo.
 *
 * Este test escanea el código fuente y falla si aparece esa escritura fuera de
 * la única puerta. Si estás leyendo esto porque el test se puso rojo: no lo
 * relajes — enruta tu cambio por `moveLeadToStage()`.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const PUERTA = path.join("server", "leads", "stage-history.ts");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...archivosTs(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Trozo que sigue a cada `.update(schema.lead)`, donde vive el `.set({…})`. */
function bloquesDeUpdate(code: string): string[] {
  const bloques: string[] = [];
  const re = /\.update\(\s*schema\.lead\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    bloques.push(code.slice(match.index, match.index + 400));
  }
  return bloques;
}

describe("guardarraíl: una sola puerta escribe la etapa del lead", () => {
  it("ningún archivo fuera de stage-history.ts actualiza lead.stageId", () => {
    const infractores: string[] = [];

    for (const file of archivosTs(SRC)) {
      if (file.endsWith(PUERTA)) continue;
      const code = readFileSync(file, "utf8");
      if (!code.includes("update(schema.lead)")) continue;

      for (const bloque of bloquesDeUpdate(code)) {
        if (/\bstageId\s*:/.test(bloque)) {
          infractores.push(path.relative(SRC, file));
          break;
        }
      }
    }

    expect(
      infractores,
      `Estos archivos cambian la etapa sin registrar el movimiento. ` +
        `Usa moveLeadToStage() de server/leads/stage-history.ts:\n` +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("la puerta sí escribe la etapa (el test detectaría el patrón)", () => {
    // Si este test falla, la detección de arriba dejó de servir: alguien
    // reescribió la puerta con otra forma y el guardarraíl quedó ciego.
    const code = readFileSync(path.join(SRC, PUERTA), "utf8");
    const bloques = bloquesDeUpdate(code);
    expect(bloques.some((b) => /\bstageId\s*:/.test(b))).toBe(true);
  });
});
