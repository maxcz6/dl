import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vigilancia: un `ON CONFLICT` sobre `contact` tiene que nombrar EXACTAMENTE
 * las columnas del índice único.
 *
 * Existe por un fallo real: la feature 014 cambió el índice de
 * `(organization_id, wa_identity)` a `(organization_id, channel, wa_identity)`
 * y dejó dos `onConflictDoNothing` apuntando al índice viejo. Postgres no falla
 * al compilar ni al arrancar: falla en la petición, con
 * "no unique or exclusion constraint matching the ON CONFLICT specification".
 *
 * El resultado fue que el Laboratorio y el alta manual de contactos quedaron
 * rotos en `main` sin que ninguna prueba lo notara — porque ninguna los
 * ejercitaba contra una base real. Este test es más barato que volver a
 * descubrirlo en producción.
 */

const CONTACT_INDEX_COLUMNS = ["organizationId", "channel", "waIdentity"];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("ON CONFLICT sobre contact", () => {
  it("nombra las tres columnas del índice único, en todos los sitios", () => {
    const offenders: string[] = [];

    for (const file of tsFilesUnder(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("schema.contact.waIdentity")) continue;

      // Solo interesan los `target: [...]` de un onConflict.
      const targets = source.matchAll(/target:\s*\[([^\]]*)\]/g);
      for (const match of targets) {
        const body = match[1] ?? "";
        if (!body.includes("schema.contact.waIdentity")) continue;
        const faltantes = CONTACT_INDEX_COLUMNS.filter(
          (col) => !body.includes(`schema.contact.${col}`)
        );
        if (faltantes.length > 0) {
          offenders.push(
            `${file.replace(process.cwd(), "")} — le falta: ${faltantes.join(", ")}`
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
