/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

const maxAttempts = 15;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  // TimeZone UTC: invariante de tiempo del proyecto (ver src/lib/db/index.ts).
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
  });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log("[migrate] migraciones aplicadas");
    await sql.end();
    process.exit(0);
  } catch (err) {
    await sql.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error("[migrate] falló tras varios intentos:", err);
      process.exit(1);
    }
    console.log(
      `[migrate] BD no lista (intento ${attempt}/${maxAttempts}), reintento en 2s…`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
