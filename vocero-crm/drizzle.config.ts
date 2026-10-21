import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit corre fuera de Next: carga .env manualmente si hace falta.
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(".env", "utf8");
    const line = env
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  } catch {
    // sin .env: se devolverá vacío y drizzle-kit dará un error claro
  }
  return "";
}

/**
 * `TimeZone=UTC` en la sesión: mismo invariante que src/lib/db/index.ts, pero
 * aquí solo cabe en la URL — drizzle-kit no expone parámetros de conexión.
 * Se manda como el parámetro de arranque `options`, que entienden tanto
 * postgres-js como libpq.
 */
function withUtcSession(url: string): string {
  if (!url || /[?&](options|TimeZone)=/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}options=-c%20timezone%3DUTC`;
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: withUtcSession(loadDatabaseUrl()),
  },
});
