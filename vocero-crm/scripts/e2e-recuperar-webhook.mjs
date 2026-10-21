/**
 * Self-test E2E — 035: «Recuperar el webhook».
 *
 * Simula a quien venía con Nea 1.x delante del CRM: la WABA enruta sus
 * webhooks a un override ajeno. Guardar la conexión lo respeta (no registra
 * el del número); «Recuperar el webhook» quita el de la WABA y deja el del
 * número hacia el CRM, y un «Guardar» posterior no lo deshace. Todo contra el
 * wa-mock: nada sale a Meta.
 *
 * Uso: app corriendo (`next dev`) con WA_MOCK_ENABLED=true y
 * META_GRAPH_BASE_URL → wa-mock;
 *   node --env-file=.env scripts/e2e-recuperar-webhook.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const WABA = "WABA-E2E-035";
const PN = "PN-E2E-035";
const TOKEN = "tok-e2e-035";
const AJENO = "https://nea-vieja.example.com/webhook/segmento-secreto";

let cookie = "";
let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}
const graph = (path, opts = {}) =>
  api(`/api/dev/wa-mock/graph/v25.0/${path}`, { ...opts, headers: { authorization: `Bearer ${TOKEN}` } });

async function main() {
  console.log("== Setup ==");
  const email = "e2e-035@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "Operador 035" }) });
  if (!su.res.ok) su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  // Lo que dejó Nea 1.x: la WABA enruta a su override, y el número sin el nuestro.
  await graph(`${WABA}/subscribed_apps`, { method: "POST", body: JSON.stringify({ override_callback_uri: AJENO }) });

  console.log("\n== Guardar la conexión respeta el override ajeno ==");
  const guardar = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: TOKEN }),
  });
  ok("se guarda", guardar.res.ok, JSON.stringify(guardar.json));
  ok(
    "y se salta el registro: skipped waba_override",
    guardar.json?.webhook?.skipped === "waba_override" && guardar.json?.webhook?.host === "nea-vieja.example.com",
    JSON.stringify(guardar.json?.webhook)
  );
  let numero = (await graph(`${PN}?fields=webhook_configuration`)).json?.webhook_configuration?.phone_number ?? null;
  ok("el número queda sin override del CRM", numero === null, String(numero));

  console.log("\n== Recuperar el webhook ==");
  const rec = await api("/api/settings/webhook", { method: "POST", body: JSON.stringify({ recuperar: true }) });
  ok("responde ok", rec.res.ok && rec.json?.ok === true, `${rec.res.status} ${JSON.stringify(rec.json)}`);
  numero = (await graph(`${PN}?fields=webhook_configuration`)).json?.webhook_configuration?.phone_number ?? null;
  ok(
    "el número apunta al webhook del CRM",
    typeof numero === "string" && numero.endsWith(`/api/webhooks/wa/${VERIFY}`),
    String(numero)
  );
  const waba = (await graph(`${WABA}/subscribed_apps`)).json?.data ?? [];
  ok(
    "el override ajeno de la WABA se quitó (si no, el siguiente «Guardar» deshace esto)",
    !waba.some((a) => a.override_callback_uri),
    JSON.stringify(waba)
  );

  console.log("\n== Un registro normal después no lo deshace ==");
  const normal = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: TOKEN }),
  });
  numero = (await graph(`${PN}?fields=webhook_configuration`)).json?.webhook_configuration?.phone_number ?? null;
  ok(
    "guardar la conexión deja el webhook del número en el CRM",
    normal.res.ok && typeof numero === "string" && numero.endsWith(`/api/webhooks/wa/${VERIFY}`),
    `${normal.res.status} ${JSON.stringify(normal.json)} · ${numero}`
  );

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
