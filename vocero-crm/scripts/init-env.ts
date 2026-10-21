/**
 * CLI de `pnpm init-env`: crea `.env` desde `.env.example` con los secretos
 * generados (crypto.randomBytes) y DOMAIN=localhost, para que
 * `docker compose up -d` arranque sin editar nada. Nunca pisa un `.env`
 * existente. Los valores generados no se imprimen.
 *
 *   pnpm init-env                                  # DOMAIN=localhost
 *   pnpm init-env --domain crm.tudominio.com       # tu dominio (y APP_BASE_URL)
 *
 * Se bundlea con esbuild (alias @ → ./src), igual que seed:demo. La lógica
 * vive en src/server/doctor/init-env.ts.
 */
import path from "node:path";
import { DEFAULT_DOMAIN, runInitEnv } from "@/server/doctor/init-env";

function usage(): void {
  console.error(
    "Uso: pnpm init-env [--domain crm.tudominio.com]\n" +
      `  Sin --domain se usa ${DEFAULT_DOMAIN} (Caddy sirve https://localhost con certificado interno).`
  );
}

let domain: string | undefined;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? "";
  if (arg === "--domain") {
    domain = args[++i];
  } else if (arg.startsWith("--domain=")) {
    domain = arg.slice("--domain=".length);
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    console.error(`Argumento desconocido: ${arg}`);
    usage();
    process.exit(1);
  }
}
if (domain !== undefined && domain === "") {
  console.error("--domain necesita un valor, p. ej. --domain crm.tudominio.com");
  process.exit(1);
}

const outcome = await runInitEnv({ dir: process.cwd(), domain });

if (outcome.status === "exists") {
  console.error(
    `Ya existe ${outcome.envPath}: no se toca (tendría tus secretos reales).\n` +
      "  Para revisar el que tienes:  pnpm doctor\n" +
      "  Para empezar de cero: renómbralo o bórralo y vuelve a correr pnpm init-env."
  );
  process.exit(1);
}
if (outcome.status === "no_example") {
  console.error(
    `No se encontró ${outcome.examplePath}. Corre pnpm init-env desde la raíz del repositorio.`
  );
  process.exit(1);
}
if (outcome.status === "bad_domain") {
  console.error(
    `Dominio no válido: "${outcome.domain}". Pásalo sin https:// ni ruta, p. ej. --domain crm.tudominio.com`
  );
  process.exit(1);
}

const { rendered, envPath } = outcome;
console.log(`.env creado: ${envPath}`);
console.log(`  Generados (no se muestran): ${rendered.generated.join(", ")}`);
console.log(
  `  Fijados: ${Object.entries(rendered.set)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ")}`
);
if (rendered.pending.length > 0) {
  console.log(`  Siguen con REEMPLAZA_ (edítalos a mano): ${rendered.pending.join(", ")}`);
}
console.log("\nQueda pendiente (opcional, se agrega después en .env):");
console.log(
  "  - OPENROUTER_API_TOKEN y OPENROUTER_MODEL: el agente de IA y el Laboratorio. Sin ellos el CRM funciona completo."
);
console.log(
  "  - La conexión de WhatsApp no va en .env: se hace desde la app, en Configuración → WhatsApp."
);
if (rendered.set.DOMAIN === DEFAULT_DOMAIN) {
  console.log(
    `  - DOMAIN=${DEFAULT_DOMAIN} sirve para probar en esta máquina (el navegador avisará del certificado). ` +
      "Para tu dominio real: edita DOMAIN y APP_BASE_URL en .env, o borra .env y corre pnpm init-env --domain crm.tudominio.com."
  );
}
console.log(`\nSiguiente: pnpm doctor  →  docker compose up -d   (en ${path.basename(process.cwd())})`);
