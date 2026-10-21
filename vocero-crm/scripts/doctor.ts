/**
 * CLI de `pnpm doctor`: valida el entorno con el MISMO esquema zod de
 * src/lib/env.ts, prueba DATABASE_URL (select 1), la escritura en MEDIA_DIR
 * y, si hay una conexión de WhatsApp guardada, una llamada a Meta con el
 * cliente de siempre. Una línea por comprobación (✓/✗) con el arreglo exacto
 * de cada ✗. Sale con 1 si algo obligatorio falla. Jamás imprime secretos.
 *
 * Carga `.env` él mismo (sin pisar lo que ya traiga el entorno del proceso),
 * así que también sirve `node --env-file=.env .tmp-doctor.mjs`. Se bundlea
 * con esbuild (alias @ → ./src), igual que seed:demo; la lógica vive en
 * src/server/doctor/checks.ts.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { getSql } from "@/lib/db";
import {
  checkAi,
  checkDispatch,
  checkDatabase,
  checkMediaBucket,
  checkMediaDir,
  checkWhatsApp,
  evaluateComposeEnv,
  evaluateEnv,
  formatResult,
  summarize,
  type CheckResult,
} from "@/server/doctor/checks";

const cwd = process.cwd();
const envPath = path.join(cwd, ".env");
const hasEnvFile = existsSync(envPath);
if (hasEnvFile) process.loadEnvFile(envPath);

const all: CheckResult[] = [];
function section(title: string, results: CheckResult[]): void {
  console.log(`\n${title}`);
  for (const r of results) {
    console.log(`  ${formatResult(r).replace(/\n/g, "\n  ")}`);
    all.push(r);
  }
}

const skip = (label: string, detail: string): CheckResult => ({ status: "skip", label, detail });

console.log("Vocero CRM — doctor");

section("Archivo .env", [
  hasEnvFile
    ? { status: "ok", label: ".env", detail: envPath }
    : {
        status: "warn",
        label: ".env",
        detail: `no existe en ${cwd}: se evalúa solo el entorno del proceso`,
        fix: "pnpm init-env (crea .env con los secretos generados; con tu dominio: pnpm init-env --domain crm.tudominio.com)",
      },
]);

const { results, env } = evaluateEnv(process.env);
section("Variables de entorno (esquema de src/lib/env.ts)", [
  ...results,
  ...evaluateComposeEnv(process.env),
]);

if (!env) {
  const porque = "el entorno no pasa el esquema: corrige las ✗ de arriba";
  section("Base de datos", [skip("DATABASE_URL", porque)]);
  section("Adjuntos", [skip("MEDIA_DIR", porque)]);
  section("WhatsApp", [skip("WhatsApp", porque)]);
} else {
  const db = await checkDatabase(env.DATABASE_URL);
  section("Base de datos", [db]);
  // 037 — El bucket solo aparece si MEDIA_STORE=bucket (conector apagado = no existe).
  const bucket = await checkMediaBucket(process.env);
  section("Adjuntos", [await checkMediaDir(env.MEDIA_DIR), ...(bucket ? [bucket] : [])]);
  if (db.status === "ok") {
    section("WhatsApp", await checkWhatsApp());
    await getSql()
      .end({ timeout: 1 })
      .catch(() => {});
  } else {
    section("WhatsApp", [
      skip("WhatsApp", "sin base de datos no se pueden leer las conexiones guardadas"),
    ]);
  }
  section("IA (opcional)", [checkAi(env)]);
  section("Cerebro externo (opcional)", [checkDispatch(process.env)]);
}

const s = summarize(all);
console.log(`\nResultado: ${s.ok} ✓ · ${s.fail} ✗ · ${s.warn} avisos`);
if (s.fail === 0) {
  console.log("Todo listo. Siguiente paso: docker compose up -d (Ruta B) o pnpm dev (desarrollo).");
} else {
  console.log("Corrige las ✗ (cada una dice cómo) y vuelve a correr pnpm doctor.");
}
process.exit(s.exitCode);
