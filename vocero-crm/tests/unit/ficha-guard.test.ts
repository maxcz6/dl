import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardarraíl de la ficha del lead.
 *
 * La ficha es información de calificación de los clientes de alguien: qué
 * presupuesto tiene, qué le duele, si decide él. Se escribe desde dos lados
 * —el cerebro externo por `PUT /api/bot/ficha` y el dueño desde la bandeja— y
 * las dos rutas entran por `upsertFicha`.
 *
 * Aquí se verifica que esa puerta filtre por organización POR SÍ MISMA, y no
 * confiando en que el llamador se acuerde. Ese "acuérdate de filtrar" es
 * exactamente como se filtran datos entre inquilinos: nada truena, y el
 * incidente se descubre cuando ya salió.
 *
 * Si estás leyendo esto porque el test se puso rojo: no lo relajes.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const PUERTA = path.join(SRC, "server", "bot", "ficha.ts");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosTs(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("guardarraíl: la ficha nunca se escribe sin organización", () => {
  const puerta = readFileSync(PUERTA, "utf8");

  it("`upsertFicha` recibe la organización", () => {
    const firma = puerta.slice(puerta.indexOf("export async function upsertFicha"));
    expect(firma.slice(0, 200)).toContain("organizationId");
  });

  it("y la usa: sus queries pasan por `scoped`, no por un `eq` pelón", () => {
    const cuerpo = puerta.slice(
      puerta.indexOf("export async function upsertFicha")
    );
    expect(cuerpo).toContain("scoped(");
    expect(cuerpo).toContain("schema.contact.organizationId");
  });

  it("nadie más escribe `contact.ficha` por su cuenta", () => {
    const culpables: string[] = [];
    for (const file of archivosTs(SRC)) {
      if (path.resolve(file) === path.resolve(PUERTA)) continue;
      const code = readFileSync(file, "utf8");
      // `.set({ … ficha … })` sobre la tabla de contactos, fuera de la puerta.
      const re = /\.update\(\s*schema\.contact\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const bloque = code.slice(m.index, m.index + 400);
        if (/\bficha\b/.test(bloque)) {
          culpables.push(path.relative(SRC, file));
        }
      }
    }
    expect(culpables).toEqual([]);
  });
});
