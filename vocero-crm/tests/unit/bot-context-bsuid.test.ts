import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { findContactByIdentity, parseIdentity } from "@/server/inbox/identity";

/**
 * R11 — El cerebro externo pregunta por `bsuid:<id>` y el contacto escribió
 * primero CON teléfono (su `wa_identity` es el teléfono, de por vida, y el
 * BSUID quedó en `wa_user_id`). La ingesta ya lo reconciliaba; el contexto
 * del bot no, y respondía 404: el cliente se quedaba sin respuesta.
 */

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});

/** Una base cuyos `select` devuelven `resultados` en orden, y que guarda cada WHERE. */
function base(resultados: unknown[][]) {
  const wheres: SQL[] = [];
  getDb.mockReturnValue({
    select: () => {
      const rows = resultados.shift() ?? [];
      const c: Record<string, unknown> = {};
      c.from = () => c;
      c.where = (w: SQL) => {
        wheres.push(w);
        return c;
      };
      c.orderBy = () => c;
      c.limit = () => Promise.resolve(rows);
      return c;
    },
  });
  return wheres;
}

const sqlDe = (w: SQL) => new PgDialect().sqlToQuery(w);

const CONTACTO = { id: "ct_tel", waIdentity: "525550001234", waUserId: "MX.bsu.1" };

describe("parseIdentity (la identidad del cerebro, leída como la ingesta)", () => {
  it("bsuid:<id> es un BSUID sin teléfono", () => {
    expect(parseIdentity("bsuid:MX.bsu.1")).toEqual({
      identity: "bsuid:MX.bsu.1",
      phone: null,
      waUserId: "MX.bsu.1",
      profileName: null,
    });
  });

  it("un teléfono se normaliza igual que el `from` del webhook (521 → 52)", () => {
    expect(parseIdentity("5215550001234")).toMatchObject({
      identity: "525550001234",
      phone: "525550001234",
      waUserId: null,
    });
  });

  it("Instagram, Messenger y un BSUID vacío no se reconcilian", () => {
    expect(parseIdentity("ig:123")).toBeNull();
    expect(parseIdentity("fb:456")).toBeNull();
    expect(parseIdentity("bsuid:")).toBeNull();
  });
});

describe("findContactByIdentity", () => {
  beforeEach(() => getDb.mockReset());

  it("la llave exacta gana y no hay segunda consulta", async () => {
    const wheres = base([[CONTACTO]]);
    await expect(findContactByIdentity("org_1", "525550001234")).resolves.toBe(CONTACTO);
    expect(wheres).toHaveLength(1);
  });

  it("bsuid sin contacto propio → el de teléfono con ese BSUID guardado", async () => {
    const wheres = base([[], [CONTACTO]]);
    await expect(findContactByIdentity("org_1", "bsuid:MX.bsu.1")).resolves.toBe(CONTACTO);
    expect(wheres).toHaveLength(2);
    // La segunda es la regla de la ingesta: por wa_user_id, solo WhatsApp.
    const q = sqlDe(wheres[1]!);
    expect(q.sql).toContain('"wa_user_id" = ');
    expect(q.sql).toContain('"channel" = ');
    expect(q.params).toEqual(expect.arrayContaining(["org_1", "whatsapp", "MX.bsu.1"]));
  });

  it("nadie con ese BSUID → undefined (el endpoint responde 404)", async () => {
    base([[], []]);
    await expect(findContactByIdentity("org_1", "bsuid:nadie")).resolves.toBeUndefined();
  });

  it("una identidad de Instagram sin llave exacta no cae a la reconciliación", async () => {
    const wheres = base([[]]);
    await expect(findContactByIdentity("org_1", "ig:123")).resolves.toBeUndefined();
    expect(wheres).toHaveLength(1);
  });
});
