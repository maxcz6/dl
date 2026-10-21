import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { scoped } from "@/lib/db/tenant";
import { schema } from "@/lib/db";

/**
 * FR-085: ninguna query de dominio sin ámbito de tenant. El helper `scoped`
 * es la única vía de WHERE en el código de dominio; aquí se verifica su
 * contrato. El aislamiento vivo se ejercita en el E2E (una sola org por
 * instancia + queries siempre scoped).
 */
describe("scoped (aislamiento por organización)", () => {
  it("organizationId vacío lanza — imposible una query sin tenant", () => {
    expect(() => scoped(schema.contact.organizationId, "")).toThrow(
      /sin tenant/
    );
  });

  it("produce el filtro de organización solo", () => {
    const condition = scoped(schema.contact.organizationId, "org_a");
    expect(condition).toBeDefined();
  });

  it("combina la organización con condiciones extra (AND)", () => {
    const condition = scoped(
      schema.contact.organizationId,
      "org_a",
      eq(schema.contact.phone, "521551111"),
      undefined // condiciones opcionales se filtran
    );
    expect(condition).toBeDefined();
    // el SQL generado contiene ambas columnas unidas por AND
    const query = new PgDialect().sqlToQuery(condition);
    expect(query.sql).toContain("organization_id");
    expect(query.sql).toContain("phone");
    expect(query.sql.toLowerCase()).toContain("and");
    expect(query.params).toContain("org_a");
  });
});
