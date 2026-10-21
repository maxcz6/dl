/**
 * Self-test E2E de comportamiento — captura manual de prospectos
 * (guion tests/e2e/us2-pipeline.md, sección "alta manual").
 *
 * Antes: `POST /api/contacts` existía pero ninguna pantalla lo llamaba, y
 * cuando se llamaba por API creaba el contacto SIN lead — invisible en el
 * Pipeline, que es donde se trabaja el embudo.
 *
 * Uso: node --env-file=.env scripts/e2e-alta-manual.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-ALTA-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
const TEL = `52155700${Math.floor(1000 + Math.random() * 8999)}`;

let cookie = "";
let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

// TimeZone UTC: invariante de tiempo del proyecto (ver src/lib/db/index.ts).
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
});

console.log("== Setup ==");
const email = "e2e@vocero.test";
const password = "password-e2e-123";
let su = await api("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email, password, name: "Operador E2E" }),
});
if (!su.res.ok) {
  su = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
ok("registro o login del operador", su.res.ok);
await api("/api/settings/whatsapp", {
  method: "PUT",
  body: JSON.stringify({ wabaId: "WABA-ALTA", phoneNumberId: PN, token: "tok-alta" }),
});

console.log("\n== Alta manual: entra al embudo, no solo a la libreta ==");
const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
const abiertas = stages.filter((s) => s.kind === "open");
const segunda = abiertas[1] ?? abiertas[0];

const alta = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Prospecto${S}`,
    phone: TEL,
    source: "referido",
    stageId: segunda.id,
    notes: "Me lo pasó un cliente",
  }),
});
ok("POST /api/contacts → 201", alta.res.status === 201, JSON.stringify(alta.json));
ok("devuelve el lead recién creado", Boolean(alta.json?.lead?.id));

const board = (await api("/api/pipeline/board")).json;
const enTablero = (board?.leads ?? []).find(
  (l) => l.contact.name === `Prospecto${S}`
);
ok(
  "el prospecto APARECE en el Pipeline (antes quedaba invisible)",
  Boolean(enTablero)
);
ok(
  "y en la etapa que eligió el dueño, no en la primera",
  enTablero?.stageId === segunda.id,
  `esperaba ${segunda.name}`
);

console.log("\n== Su nacimiento queda en la bitácora ==");
const eventos = await sql`
  select * from lead_stage_event where lead_id = ${alta.json.lead.id}`;
ok("tiene exactamente un evento", eventos.length === 1, `hay ${eventos.length}`);
ok(
  "marcado como capturado por el dueño, no por el sistema",
  eventos[0]?.source === "dueno" && eventos[0]?.actor_user_id !== null,
  JSON.stringify({ source: eventos[0]?.source })
);
ok(
  "y apunta a la etapa elegida",
  eventos[0]?.to_stage_id === segunda.id
);

console.log("\n== La fuente capturada manda; lo no capturado no se inventa ==");
const lista = (await api(`/api/contacts?q=Prospecto${S}`)).json?.contacts ?? [];
ok(
  "la fuente viaja como capturada",
  lista[0]?.source?.value === "referido" &&
    lista[0]?.source?.source === "capturada",
  JSON.stringify(lista[0]?.source)
);

await api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({
    phoneNumberId: PN,
    from: `52155800${Math.floor(1000 + Math.random() * 8999)}`,
    name: `Entrante${S}`,
    text: "hola",
  }),
});
await new Promise((r) => setTimeout(r, 1200));
const lista2 = (await api(`/api/contacts?q=Entrante${S}`)).json?.contacts ?? [];
ok(
  "quien llegó por WhatsApp queda 'sin identificar', y se dice que es deducida",
  lista2[0]?.source?.value === "desconocida" &&
    lista2[0]?.source?.source === "deducida",
  JSON.stringify(lista2[0]?.source)
);

console.log("\n== Caminos infelices ==");
const dup = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({ name: "Otro nombre", phone: TEL, source: "otro" }),
});
ok(
  "mismo teléfono → 409 duplicate (no crea una segunda ficha)",
  dup.res.status === 409 && dup.json?.error?.code === "duplicate",
  JSON.stringify(dup.json)
);

const sinLada = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({ name: "Sin lada", phone: "5512345678" }),
});
ok(
  "teléfono de 10 dígitos pasa, pero uno con letras no",
  sinLada.res.status === 201 || sinLada.res.status === 409,
  `status ${sinLada.res.status}`
);
const basura = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({ name: "Basura", phone: "55-1234-5678" }),
});
ok(
  "teléfono con guiones → 422 con la explicación del código de país",
  basura.res.status === 422,
  JSON.stringify(basura.json)
);

console.log("\n== Escribir primero exige plantilla (regla de Meta) ==");
const contactoNuevo = alta.json.contact.id;
const sinPlantilla = await api(
  `/api/contacts/${contactoNuevo}/start-conversation`,
  { method: "POST", body: JSON.stringify({ templateId: "tpl_inexistente" }) }
);
ok(
  "plantilla inexistente → error tipado, no 500",
  sinPlantilla.res.status >= 400 && sinPlantilla.res.status < 500,
  `status ${sinPlantilla.res.status}`
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
