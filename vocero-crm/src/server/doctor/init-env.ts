import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * `pnpm init-env` — crea `.env` a partir de `.env.example` con los secretos
 * ya generados, para que `docker compose up -d` arranque sin editar nada.
 *
 * La lógica es pura (texto → texto) a propósito: se prueba sin tocar el
 * disco, y el CLI (scripts/init-env.ts) solo decide si puede escribir. Los
 * comentarios del ejemplo se conservan: el `.env` resultante sigue siendo la
 * guía inline de cada variable.
 */

/** Prefijo de los valores de ejemplo que hay que sustituir. */
export const PLACEHOLDER_PREFIX = "REEMPLAZA_";

/** Dominio por defecto: el Caddyfile lo sirve con certificado interno. */
export const DEFAULT_DOMAIN = "localhost";

/**
 * Los secretos que el arranque exige (src/lib/env.ts) más la contraseña de
 * Postgres del compose. El comando `openssl` es el que pedía la documentación:
 * `pnpm doctor` lo sugiere cuando falta uno en un `.env` que ya existe.
 */
export const GENERATED_SECRETS = {
  POSTGRES_PASSWORD: {
    generate: () => randomBytes(24).toString("hex"),
    openssl: "openssl rand -hex 24",
  },
  BETTER_AUTH_SECRET: {
    generate: () => randomBytes(32).toString("base64"),
    openssl: "openssl rand -base64 32",
  },
  // Exactamente 32 bytes: es lo que valida el esquema (AES-256-GCM).
  ENCRYPTION_KEY: {
    generate: () => randomBytes(32).toString("base64"),
    openssl: "openssl rand -base64 32",
  },
  META_WEBHOOK_VERIFY_TOKEN: {
    generate: () => randomBytes(32).toString("hex"),
    openssl: "openssl rand -hex 32",
  },
  // 2.0 — Firma el despacho y con ella el agente (Nea) le contesta al CRM por
  // /api/bot/*. El compose ya cablea el despacho a Nea: sin esta llave, el
  // par arrancaría con el despacho apagado.
  BOT_API_KEY: {
    generate: () => randomBytes(32).toString("hex"),
    openssl: "openssl rand -hex 32",
  },
} as const;

export type GeneratedSecret = keyof typeof GENERATED_SECRETS;

export function generateSecrets(): Record<GeneratedSecret, string> {
  const out = {} as Record<GeneratedSecret, string>;
  for (const key of Object.keys(GENERATED_SECRETS) as GeneratedSecret[]) {
    out[key] = GENERATED_SECRETS[key].generate();
  }
  return out;
}

/** Un dominio sin esquema ni ruta: lo que Caddy pone en su site address. */
export function isValidDomain(domain: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(domain);
}

export type RenderedEnv = {
  content: string;
  /** Variables cuyo valor se generó (solo nombres: los valores no se imprimen). */
  generated: string[];
  /** Variables fijadas a un valor no secreto (DOMAIN, APP_BASE_URL). */
  set: Record<string, string>;
  /** Variables activas que siguen con REEMPLAZA_ (hoy ninguna; por si el ejemplo crece). */
  pending: string[];
};

/**
 * Transforma el texto de `.env.example` en el de un `.env` listo para
 * arrancar. Línea a línea: solo cambian las variables activas (sin `#`) que
 * hay que generar o fijar; comentarios y todo lo demás quedan igual.
 */
export function renderInitEnv(
  example: string,
  opts: { domain?: string; secrets?: Record<GeneratedSecret, string> } = {}
): RenderedEnv {
  const domain = opts.domain ?? DEFAULT_DOMAIN;
  const secrets = opts.secrets ?? generateSecrets();
  const set: Record<string, string> = {
    DOMAIN: domain,
    APP_BASE_URL: `https://${domain}`,
  };
  const generated: string[] = [];
  const pending: string[] = [];
  const eol = example.includes("\r\n") ? "\r\n" : "\n";

  const lines = example.split(/\r?\n/).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) return line;
    const key = match[1] as string;
    const value = match[2] as string;

    if (key in secrets) {
      generated.push(key);
      return `${key}=${secrets[key as GeneratedSecret]}`;
    }
    if (key in set) return `${key}=${set[key]}`;
    if (key === "DATABASE_URL") {
      // postgresql://usuario:REEMPLAZA_...@host:puerto/base → la misma
      // contraseña que acaba de recibir POSTGRES_PASSWORD.
      const url = /^(\w+:\/\/[^:/@]+:)REEMPLAZA_[^@]*(@.*)$/.exec(value);
      if (url) {
        generated.push(key);
        return `${key}=${url[1]}${secrets.POSTGRES_PASSWORD}${url[2]}`;
      }
    }
    if (value.includes(PLACEHOLDER_PREFIX)) pending.push(key);
    return line;
  });

  return { content: lines.join(eol), generated, set, pending };
}

export type InitEnvIo = {
  exists: (file: string) => Promise<boolean>;
  read: (file: string) => Promise<string>;
  /** Debe fallar si el archivo ya existe (flag "wx"): la comprobación previa no basta sola. */
  writeNew: (file: string, content: string) => Promise<void>;
};

const defaultIo: InitEnvIo = {
  exists: (file) =>
    access(file).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return false;
        throw err;
      }
    ),
  read: (file) => readFile(file, "utf8"),
  // 0600: el archivo lleva secretos. flag wx: nunca pisa uno existente.
  writeNew: (file, content) => writeFile(file, content, { mode: 0o600, flag: "wx" }),
};

export type InitEnvOutcome =
  | { status: "created"; rendered: RenderedEnv; envPath: string }
  | { status: "exists"; envPath: string }
  | { status: "no_example"; examplePath: string }
  | { status: "bad_domain"; domain: string };

/**
 * Decide y ejecuta: crea `<dir>/.env` desde `<dir>/.env.example`. Nunca pisa
 * un `.env` existente (quien lo tiene ya puso ahí sus secretos reales).
 */
export async function runInitEnv(
  opts: { dir: string; domain?: string; io?: InitEnvIo }
): Promise<InitEnvOutcome> {
  const io = opts.io ?? defaultIo;
  const envPath = path.join(opts.dir, ".env");
  const examplePath = path.join(opts.dir, ".env.example");
  const domain = opts.domain ?? DEFAULT_DOMAIN;

  if (!isValidDomain(domain)) return { status: "bad_domain", domain };
  if (await io.exists(envPath)) return { status: "exists", envPath };
  if (!(await io.exists(examplePath))) return { status: "no_example", examplePath };

  const rendered = renderInitEnv(await io.read(examplePath), { domain });
  try {
    await io.writeNew(envPath, rendered.content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return { status: "exists", envPath };
    }
    throw err;
  }
  return { status: "created", rendered, envPath };
}
