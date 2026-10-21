import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeParseEnv } from "@/lib/env";
import {
  generateSecrets,
  GENERATED_SECRETS,
  renderInitEnv,
  runInitEnv,
} from "@/server/doctor/init-env";

/**
 * `pnpm init-env` existe para que `docker compose up -d` arranque sin editar
 * nada. Se prueba sobre el `.env.example` REAL del repo: si el ejemplo gana
 * una variable obligatoria sin generador, o cambia la forma de un
 * placeholder, esto se pone rojo antes que la instalación de alguien.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const EJEMPLO = readFileSync(path.join(RAIZ, ".env.example"), "utf8");

/** Solo las líneas activas (sin `#`), como las lee docker compose. */
function activas(content: string): string[] {
  return content.split(/\r?\n/).filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));
}

describe("generateSecrets", () => {
  it("genera justo los secretos que la documentación pedía con openssl, con la forma que exige el esquema", () => {
    const s = generateSecrets();
    expect(Object.keys(s).sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "BOT_API_KEY",
      "ENCRYPTION_KEY",
      "META_WEBHOOK_VERIFY_TOKEN",
      "POSTGRES_PASSWORD",
    ]);
    // AES-256-GCM: exactamente 32 bytes (44 caracteres en base64).
    expect(Buffer.from(s.ENCRYPTION_KEY, "base64")).toHaveLength(32);
    expect(s.ENCRYPTION_KEY).toHaveLength(44);
    expect(s.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(16);
    // hex: va dentro de una URL (DATABASE_URL) y del path del webhook sin escapar.
    expect(s.META_WEBHOOK_VERIFY_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(s.POSTGRES_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
    // 2.0 — Firma el despacho al agente del compose: hex, en una cabecera.
    expect(s.BOT_API_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cada llamada produce valores distintos", () => {
    const a = generateSecrets();
    const b = generateSecrets();
    for (const key of Object.keys(GENERATED_SECRETS) as (keyof typeof GENERATED_SECRETS)[]) {
      expect(a[key]).not.toBe(b[key]);
    }
  });

  it("cada secreto conserva el comando openssl equivalente (lo sugiere pnpm doctor)", () => {
    expect(GENERATED_SECRETS.ENCRYPTION_KEY.openssl).toBe("openssl rand -base64 32");
    expect(GENERATED_SECRETS.META_WEBHOOK_VERIFY_TOKEN.openssl).toBe("openssl rand -hex 32");
    expect(GENERATED_SECRETS.POSTGRES_PASSWORD.openssl).toBe("openssl rand -hex 24");
  });
});

describe("renderInitEnv sobre el .env.example real", () => {
  it("deja un .env que pasa el esquema de arranque, sin REEMPLAZA_ activos y con DOMAIN=localhost", () => {
    const r = renderInitEnv(EJEMPLO);
    const vars = parseEnv(r.content);

    expect(r.pending).toEqual([]);
    expect(activas(r.content).some((l) => l.includes("REEMPLAZA_"))).toBe(false);
    expect(vars.DOMAIN).toBe("localhost");
    expect(vars.APP_BASE_URL).toBe("https://localhost");

    // Lo que importa de verdad: el mismo esquema que valida el arranque lo acepta.
    const parsed = safeParseEnv(vars);
    expect(parsed.success).toBe(true);
  });

  it("la contraseña de Postgres es la misma en POSTGRES_PASSWORD y dentro de DATABASE_URL", () => {
    const secrets = { ...generateSecrets(), POSTGRES_PASSWORD: "abc123def456" };
    const vars = parseEnv(renderInitEnv(EJEMPLO, { secrets }).content);
    expect(vars.POSTGRES_PASSWORD).toBe("abc123def456");
    expect(vars.DATABASE_URL).toBe("postgresql://postgres:abc123def456@postgres:5432/vocero");
  });

  it("--domain fija DOMAIN y APP_BASE_URL con https", () => {
    const vars = parseEnv(renderInitEnv(EJEMPLO, { domain: "crm.ejemplo.com" }).content);
    expect(vars.DOMAIN).toBe("crm.ejemplo.com");
    expect(vars.APP_BASE_URL).toBe("https://crm.ejemplo.com");
  });

  it("conserva los comentarios y las opcionales comentadas: el .env sigue siendo la guía inline", () => {
    const r = renderInitEnv(EJEMPLO);
    const antes = EJEMPLO.split(/\r?\n/);
    const despues = r.content.split(/\r?\n/);
    expect(despues).toHaveLength(antes.length);
    antes.forEach((linea, i) => {
      if (!/^[A-Z][A-Z0-9_]*=/.test(linea)) expect(despues[i]).toBe(linea);
    });
    expect(r.content).toContain("# OPENROUTER_API_TOKEN=");
    expect(r.content).toContain("# AGENDA=on");
  });

  it("reporta qué generó y qué fijó, por nombre y sin los valores", () => {
    const secrets = generateSecrets();
    const r = renderInitEnv(EJEMPLO, { secrets });
    expect(r.generated).toEqual([
      "POSTGRES_PASSWORD",
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "ENCRYPTION_KEY",
      "META_WEBHOOK_VERIFY_TOKEN",
      "BOT_API_KEY",
    ]);
    expect(r.set).toEqual({ DOMAIN: "localhost", APP_BASE_URL: "https://localhost" });
    const resumen = JSON.stringify({ generated: r.generated, set: r.set });
    for (const valor of Object.values(secrets)) expect(resumen).not.toContain(valor);
  });

  it("respeta el final de línea del ejemplo (CRLF en un checkout de Windows, LF en el VPS)", () => {
    const lf = EJEMPLO.replace(/\r\n/g, "\n");
    expect(renderInitEnv(lf).content).not.toContain("\r");
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(renderInitEnv(crlf).content.split("\r\n").length).toBe(lf.split("\n").length);
  });
});

describe("runInitEnv", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "vocero-init-env-"));
    await writeFile(path.join(dir, ".env.example"), EJEMPLO);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("crea .env cuando no existe, con el contenido renderizado", async () => {
    const outcome = await runInitEnv({ dir });
    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    const escrito = await readFile(path.join(dir, ".env"), "utf8");
    expect(escrito).toBe(outcome.rendered.content);
    expect(safeParseEnv(parseEnv(escrito)).success).toBe(true);
  });

  it("no pisa un .env existente: avisa y no cambia ni un byte", async () => {
    // Un .env existente tiene los secretos reales de alguien (y quizá el
    // token de WhatsApp cifrado con ESA ENCRYPTION_KEY en su base).
    await writeFile(path.join(dir, ".env"), "MIO=1\n");
    const outcome = await runInitEnv({ dir });
    expect(outcome.status).toBe("exists");
    expect(await readFile(path.join(dir, ".env"), "utf8")).toBe("MIO=1\n");
  });

  it("sin .env.example no inventa nada", async () => {
    await rm(path.join(dir, ".env.example"));
    const outcome = await runInitEnv({ dir });
    expect(outcome.status).toBe("no_example");
  });

  it("rechaza un dominio con esquema o ruta (Caddy quiere solo el host)", async () => {
    expect((await runInitEnv({ dir, domain: "https://crm.ejemplo.com" })).status).toBe("bad_domain");
    expect((await runInitEnv({ dir, domain: "crm.ejemplo.com/app" })).status).toBe("bad_domain");
    expect((await runInitEnv({ dir, domain: "crm.ejemplo.com" })).status).toBe("created");
  });
});
