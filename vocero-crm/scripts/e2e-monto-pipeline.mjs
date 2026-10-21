/**
 * Self-test E2E de comportamiento — monto de la negociación
 * (guion tests/e2e/us2-pipeline.md, sección "monto").
 *
 * El total por columna lo suma el CLIENTE, así que aquí se verifica lo que lo
 * alimenta: que el monto se guarde sin mover la tarjeta, que viaje con su
 * moneda, y que la moneda del negocio llegue al tablero. La aritmética tiene
 * sus propias pruebas en tests/unit/money.test.ts.
 *
 * Uso: node --env-file=.env scripts/e2e-monto-pipeline.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-MONTO-1";
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
  body: JSON.stringify({ wabaId: "WABA-MON", phoneNumberId: PN, token: "tok-mon" }),
});

const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
const abiertas = stages.filter((s) => s.kind === "open");
const alta = await api("/api/contacts", {
  method: "POST",
  body: JSON.stringify({
    name: `Trato${S}`,
    phone: `52155900${Math.floor(1000 + Math.random() * 8999)}`,
    source: "referido",
  }),
});
const leadId = alta.json?.lead?.id;
ok("prospecto de prueba creado", Boolean(leadId));

console.log("\n== Capturar el monto NO mueve la tarjeta ==");
const antes = (await api("/api/pipeline/board")).json;
const etapaAntes = antes.leads.find((l) => l.id === leadId)?.stageId;

const guardado = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ amountCents: 1_250_050 }),
});
ok(
  "PATCH solo con monto → 200 (sin stageId)",
  guardado.res.ok,
  JSON.stringify(guardado.json)
);

const board = (await api("/api/pipeline/board")).json;
const tarjeta = board.leads.find((l) => l.id === leadId);
ok("el monto quedó guardado en centavos", tarjeta?.amountCents === 1_250_050);
ok(
  "la tarjeta NO se movió de etapa",
  tarjeta?.stageId === etapaAntes,
  `antes ${etapaAntes}, ahora ${tarjeta?.stageId}`
);
ok(
  "el monto viaja con su moneda, tomada del negocio",
  tarjeta?.currency === board.currency,
  JSON.stringify({ lead: tarjeta?.currency, negocio: board.currency })
);
ok(
  "el tablero informa la moneda del negocio",
  typeof board.currency === "string" && board.currency.length === 3,
  JSON.stringify(board.currency)
);

console.log("\n== Mover la tarjeta conserva el monto ==");
const otra = abiertas.find((s) => s.id !== etapaAntes) ?? abiertas[0];
await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ stageId: otra.id, position: 0 }),
});
const trasMover = (await api("/api/pipeline/board")).json.leads.find(
  (l) => l.id === leadId
);
ok(
  "sigue valiendo lo mismo tras cambiar de columna",
  trasMover?.amountCents === 1_250_050,
  JSON.stringify(trasMover?.amountCents)
);

console.log("\n== Cambiar la moneda del negocio ==");
const marca = (await api("/api/settings/branding")).json?.branding;
const nuevaMoneda = marca.currency === "USD" ? "MXN" : "USD";
const put = await api("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({
    name: marca.name,
    accent: marca.accent,
    currency: nuevaMoneda,
  }),
});
ok("la moneda se guarda en Ajustes → Marca", put.res.ok, JSON.stringify(put.json));
const board2 = (await api("/api/pipeline/board")).json;
ok(
  "y el tablero la refleja",
  board2.currency === nuevaMoneda,
  JSON.stringify(board2.currency)
);
ok(
  "el monto ya capturado conserva SU moneda (no se reinterpreta)",
  board2.leads.find((l) => l.id === leadId)?.currency === marca.currency,
  "un importe capturado en pesos no se vuelve dólares porque cambie el ajuste"
);
// Volver a dejarlo como estaba para no ensuciar corridas siguientes.
await api("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({ name: marca.name, accent: marca.accent, currency: marca.currency }),
});

console.log("\n== Caminos infelices ==");
const borrado = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ amountCents: null }),
});
const trasBorrar = (await api("/api/pipeline/board")).json.leads.find(
  (l) => l.id === leadId
);
ok(
  "amountCents null borra el monto y su moneda",
  borrado.res.ok &&
    trasBorrar?.amountCents === null &&
    trasBorrar?.currency === null,
  JSON.stringify({ cents: trasBorrar?.amountCents, cur: trasBorrar?.currency })
);

const vacio = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({}),
});
ok(
  "un PATCH sin nada que cambiar → 422, no un 200 mentiroso",
  vacio.res.status === 422,
  JSON.stringify(vacio.json)
);

const negativo = await api(`/api/pipeline/leads/${leadId}`, {
  method: "PATCH",
  body: JSON.stringify({ amountCents: -500 }),
});
ok("monto negativo → 422", negativo.res.status === 422);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
process.exit(failures === 0 ? 0 : 1);
