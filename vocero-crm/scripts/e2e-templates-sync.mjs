/**
 * Self-test E2E de comportamiento — sincronización de plantillas (guion
 * tests/e2e/us6-templates.md, sección "modo agencia").
 *
 * Reproduce un fallo visto en producción: Meta aprobó una plantilla y la
 * reclasificó de UTILITY a MARKETING, pero el CRM la seguía mostrando
 * "Pendiente de Meta" porque el webhook
 * `message_template_status_update` se entrega al callback A NIVEL APP (que en
 * modo agencia no es el de esta instancia). El único camino es el pull.
 *
 * Uso: node --env-file=.env scripts/e2e-templates-sync.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

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
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const PN = "PN-TPL-1";
const WABA = "WABA-TPL";
const stamp = Date.now().toString(36);

async function findTemplate(name) {
  const { json } = await api("/api/templates");
  return (json?.templates ?? []).find((t) => t.name === name);
}

/** Mueve SOLO el panel simulado de Meta: sin webhook, como en modo agencia. */
function metaApproves(name, category) {
  return api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({
      wabaId: WABA,
      name,
      language: "es_MX",
      event: "APPROVED",
      category,
      notify: false,
    }),
  });
}

async function main() {
  console.log("== Setup: registro + conexión WhatsApp ==");
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
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));

  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: "tok-tpl" }),
  });
  ok("conexión WhatsApp guardada", conn.res.ok, JSON.stringify(conn.json));

  console.log("\n== us6: alta de plantilla → Pendiente de Meta ==");
  const name = `seguimiento_${stamp}`;
  const created = await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name,
      language: "es_MX",
      category: "UTILITY",
      body: "Hola {{1}} 👋 ¿Retomamos tu cotización?",
    }),
  });
  ok("plantilla creada y enviada a Meta", created.res.ok, JSON.stringify(created.json));
  let local = await findTemplate(name);
  ok("estado inicial = pending", local?.status === "pending", local?.status);
  ok("categoría inicial = UTILITY", local?.category === "UTILITY", local?.category);

  console.log("\n== us6: Meta aprueba y reclasifica, SIN webhook (modo agencia) ==");
  const flip = await metaApproves(name, "MARKETING");
  ok("panel de Meta movido sin entregar webhook", flip.json?.delivered === false, JSON.stringify(flip.json));

  local = await findTemplate(name);
  ok(
    "el CRM sigue en pending (el webhook nunca llega) — este era el bug",
    local?.status === "pending",
    local?.status
  );

  console.log("\n== us6: el pull sincroniza estado Y categoría ==");
  const sync = await api("/api/templates/sync", { method: "POST" });
  ok("sync 200", sync.res.ok, JSON.stringify(sync.json));
  ok("sync reporta 1 actualizada", sync.json?.updated === 1, JSON.stringify(sync.json));

  local = await findTemplate(name);
  ok("estado = approved", local?.status === "approved", local?.status);
  ok(
    "categoría reclasificada por Meta = MARKETING",
    local?.category === "MARKETING",
    local?.category
  );

  console.log("\n== us6: idempotencia del sync ==");
  const again = await api("/api/templates/sync", { method: "POST" });
  ok("segundo sync no reescribe nada", again.json?.updated === 0, JSON.stringify(again.json));

  console.log("\n== us6: camino infeliz — Meta caído no tumba la pantalla ==");
  const listStillOk = await api("/api/templates");
  ok(
    "GET /api/templates responde aunque el sync sea aparte",
    listStillOk.res.ok && (listStillOk.json?.templates?.length ?? 0) > 0
  );

  console.log(
    `\n${failures === 0 ? "TODO VERDE" : "CON FALLOS"} — ${checks - failures}/${checks} checks`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
