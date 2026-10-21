/**
 * Self-test E2E de comportamiento — prioridad del lead
 * (guion tests/e2e/us2-pipeline.md, sección "prioridad").
 *
 * Lo que se verifica sobre todo es lo que NO pasa: que nada escriba la
 * prioridad por su cuenta. Un CRM que la adivina y pisa lo que el dueño puso
 * es un CRM en el que se deja de mirar esa columna.
 *
 * Uso: node --env-file=.env scripts/e2e-prioridad.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-PRIO-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

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
const board = async () => (await api("/api/pipeline/board")).json;
const tarjeta = async (id) => (await board()).leads.find((l) => l.id === id);

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
  body: JSON.stringify({ wabaId: "WABA-PRI", phoneNumberId: PN, token: "tok-pri" }),
});

const alta = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Prio${S}`,
    phone: `52156000${Math.floor(1000 + Math.random() * 8999)}`,
  }),
});
const leadId = alta.json?.lead?.id;
ok("prospecto de prueba creado", Boolean(leadId));

console.log("\n== Nace SIN prioridad, no con una inventada ==");
ok(
  "un lead nuevo no trae prioridad",
  (await tarjeta(leadId))?.priority === null,
  JSON.stringify((await tarjeta(leadId))?.priority)
);

console.log("\n== La fija el dueño y se queda ==");
const puesta = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ priority: "alta" }),
});
ok("PATCH con prioridad → 200", puesta.res.ok, JSON.stringify(puesta.json));
ok("queda guardada", (await tarjeta(leadId))?.priority === "alta");

console.log("\n== Nada la pisa ==");
const stages = (await api("/api/pipeline/stages")).json.stages;
const actual = await tarjeta(leadId);
const otra = stages.find((s) => s.kind === "open" && s.id !== actual.stageId);
await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: otra.id, position: 0 }),
});
ok(
  "mover la tarjeta de etapa NO cambia la prioridad",
  (await tarjeta(leadId))?.priority === "alta"
);
await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ amountCents: 500000 }),
});
ok(
  "capturar el monto tampoco la toca",
  (await tarjeta(leadId))?.priority === "alta"
);

// Un mensaje entrante mueve la actividad del lead: tampoco debe opinar.
await api("/api/dev/wa-mock/inbound", {
  method: "POST",
  body: JSON.stringify({
    phoneNumberId: PN,
    from: alta.json.contact.phone,
    name: `Prio${S}`,
    text: "sigo interesado",
  }),
});
await new Promise((r) => setTimeout(r, 1200));
ok(
  "un mensaje entrante tampoco la reescribe",
  (await tarjeta(leadId))?.priority === "alta"
);

console.log("\n== Se puede QUITAR, no solo cambiar ==");
const bajada = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ priority: "baja" }),
});
ok("cambiar de alta a baja", bajada.res.ok && (await tarjeta(leadId))?.priority === "baja");

const quitada = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ priority: null }),
});
ok(
  "null la quita: un clic por error no queda para siempre",
  quitada.res.ok && (await tarjeta(leadId))?.priority === null
);

console.log("\n== Llega a la lista de Contactos ==");
await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ priority: "alta" }),
});
const lista = (await api(`/api/contacts?q=Prio${S}`)).json?.contacts ?? [];
ok(
  "el contacto trae la prioridad de su lead",
  lista[0]?.priority === "alta",
  JSON.stringify(lista[0]?.priority)
);

console.log("\n== Camino infeliz ==");
const basura = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ priority: "urgentísima" }),
});
ok(
  "una prioridad fuera del catálogo → 422",
  basura.res.status === 422,
  JSON.stringify(basura.json)
);
ok(
  "y la que había sigue intacta",
  (await tarjeta(leadId))?.priority === "alta"
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
process.exit(failures === 0 ? 0 : 1);
