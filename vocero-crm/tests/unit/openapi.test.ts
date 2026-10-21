import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { armarEvento, construirEventoOlvido } from "@/server/brains/contract";
import { CLAVES_HERRAMIENTA } from "@/lib/agent-roles";
import openapi from "../../docs/openapi.json";

/**
 * 035 — El OpenAPI es el contrato del cerebro, y se valida contra el código:
 * una ruta nueva sin documentar, una documentada que ya no existe, o un
 * cuerpo del despacho que cambie sin tocar el documento ponen esto en rojo.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const BOT = path.join(RAIZ, "src", "app", "api", "bot");
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Doc = {
  paths: Record<string, Record<string, unknown>>;
  webhooks: Record<string, { post: { requestBody: { content: { "application/json": { examples: { gemelo: { value: unknown } } } } } } }>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
};
const doc = openapi as unknown as Doc;

/** Las rutas del código: `/api/bot/...` → métodos exportados. */
function rutasDelCodigo(dir = BOT, prefijo = "/api/bot"): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    if (!statSync(ruta).isDirectory()) continue;
    // `[...ruta]` (comodín) se documenta como `{ruta}`.
    const segmento = nombre.replace(/^\[(?:\.\.\.)?(.+)\]$/, "{$1}");
    const archivo = path.join(ruta, "route.ts");
    try {
      const fuente = readFileSync(archivo, "utf8");
      out[`${prefijo}/${segmento}`] = METODOS.filter((m) =>
        new RegExp(`export (async )?function ${m}\\b|export const ${m}\\b`).test(fuente)
      ).map((m) => m.toLowerCase());
    } catch {
      // Carpeta intermedia sin route.ts (p. ej. `media/` antes de `[mediaId]`).
    }
    Object.assign(out, rutasDelCodigo(ruta, `${prefijo}/${segmento}`));
  }
  return out;
}

describe("el OpenAPI contra las rutas", () => {
  const codigo = rutasDelCodigo();

  it("cada ruta de /api/bot está documentada, con sus métodos", () => {
    for (const [ruta, metodos] of Object.entries(codigo)) {
      expect(doc.paths[ruta], `falta ${ruta} en docs/openapi.json`).toBeDefined();
      expect(Object.keys(doc.paths[ruta]!).sort(), ruta).toEqual([...metodos].sort());
    }
  });

  it("y no documenta rutas que no existen", () => {
    for (const ruta of Object.keys(doc.paths)) {
      expect(codigo[ruta], `${ruta} está en el OpenAPI y no en el código`).toBeDefined();
    }
  });

  it("los 409 de /api/bot/messages son los que la ruta devuelve", () => {
    const fuente = readFileSync(path.join(BOT, "messages", "route.ts"), "utf8");
    const enCodigo = [...fuente.matchAll(/apiError\(409, "([a-z_]+)"/g)].map((m) => m[1]).sort();
    const post = doc.paths["/api/bot/messages"]!.post as { "x-codigos-409": string[] };
    expect([...post["x-codigos-409"]].sort()).toEqual(enCodigo);
  });

  it("el perfil declara role y las claves del catálogo de herramientas", () => {
    const perfil = doc.components.schemas.Perfil!.properties!.profile as {
      properties: { role: unknown; tools: { items: { enum: string[] } } };
    };
    expect(perfil.properties.role).toBeDefined();
    expect(perfil.properties.tools.items.enum).toEqual([...CLAVES_HERRAMIENTA]);
  });
});

describe("los ejemplos son los cuerpos gemelos", () => {
  it("el despacho: lo que arma el CRM con los datos de la prueba gemela", () => {
    const ejemplo = doc.webhooks.despacho!.post.requestBody.content["application/json"].examples.gemelo.value;
    const armado = armarEvento({
      dispatchId: "dsp_prueba0000000000001",
      organization: { id: "org_prueba", slug: "mi-negocio" },
      conversation: {
        id: "cv_prueba",
        channel: "whatsapp",
        aiEnabled: true,
        windowOpen: true,
        windowExpiresAt: new Date("2026-10-09T05:10:11.000Z"),
      },
      contact: { id: "ct_prueba", displayName: "Ana Pérez", identity: "5215512345678" },
      messages: [
        { id: "msg_1", createdAt: new Date("2026-10-08T05:10:03.000Z"), type: "text", text: "hola, ¿tienen el modelo azul?", media: null },
        {
          id: "msg_2",
          createdAt: new Date("2026-10-08T05:10:11.000Z"),
          type: "image",
          text: null,
          media: { waMediaId: "1234567890", mimeType: "image/jpeg", caption: "este" },
        },
      ],
      firstMessageAt: new Date("2026-10-08T05:10:03.000Z"),
      lastMessageAt: new Date("2026-10-08T05:10:11.000Z"),
    });
    // Igual hasta en el orden de las claves: se firma el JSON tal como sale.
    expect(JSON.stringify(ejemplo)).toBe(JSON.stringify(armado));
  });

  it("el olvido", () => {
    const ejemplo = doc.webhooks.olvido!.post.requestBody.content["application/json"].examples.gemelo.value;
    const armado = construirEventoOlvido({
      eventId: "olv_gemelo1",
      organization: { id: "org_gemela", slug: "gemela" },
      conversation: { id: "cv_gemela1", channel: "whatsapp" },
      contact: { id: "ct_gemelo1", identity: "5215550001111" },
      deletedAt: new Date("2026-10-04T12:00:00.000Z"),
    });
    expect(JSON.stringify(ejemplo)).toBe(JSON.stringify(armado));
  });
});
