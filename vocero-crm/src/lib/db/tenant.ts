import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Scope de tenant obligatorio (Constitución III).
 *
 * Toda query de dominio se construye con `scoped(...)`: exige el
 * organization_id explícito y lo combina con el resto de condiciones,
 * de modo que un WHERE sin tenant no compile de forma natural.
 */
export function scoped(
  organizationColumn: PgColumn,
  organizationId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  if (!organizationId) {
    throw new Error("scoped(): organizationId vacío — query sin tenant");
  }
  const base = eq(organizationColumn, organizationId);
  const rest = conditions.filter((c): c is SQL => c !== undefined);
  return rest.length > 0 ? and(base, ...rest)! : base;
}
