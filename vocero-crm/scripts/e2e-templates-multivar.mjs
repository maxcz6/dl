/**
 * Self-test E2E de comportamiento — plantillas con VARIAS variables
 * (guion tests/e2e/us6-templates.md, sección "multivariable").
 *
 * Reproduce el bloqueo reportado el 2026-08-09: el CRM rechazaba en la propia
 * pantalla un cuerpo con {{1}} {{2}} {{3}} ("v1 admite una sola variable"),
 * aunque Meta las acepta. Cubre alta, aprobación, envío con N parámetros y los
 * caminos infelices (numeración con saltos, valor faltante).
 *
 * Uso: node --env-file=.env scripts/e2e-templates-multivar.mjs
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

const PN = "PN-TPLMV-1";
const WABA = "WABA-TPLMV";
const FROM = "5215599990001";
const stamp = Date.now().toString(36);

async function findTemplate(name) {
  const { json } = await api("/api/templates");
  return (json?.templates ?? []).find((t) => t.name === name);
}

function metaApproves(name) {
  return api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({
      wabaId: WABA,
      name,
      language: "es_MX",
      event: "APPROVED",
      notify: false,
    }),
  });
}

async function lastOutbound() {
  const { json } = await api("/api/dev/wa-mock/outbox");
  const list = json?.outbox ?? [];
  return list[list.length - 1] ?? null;
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
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: "tok-mv" }),
  });
  ok("conexión WhatsApp guardada", conn.res.ok, JSON.stringify(conn.json));

  console.log("\n== Alta: cuerpo con TRES variables ==");
  const name = `confirmacion_cita_${stamp}`;
  const body =
    "Hola {{1}} 👋 Te confirmamos tu cita:\n" +
    "🗓 {{2}} a las {{3}} · 20-30 min";
  const created = await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name, language: "es_MX", category: "UTILITY", body }),
  });
  ok(
    "plantilla de 3 variables aceptada (antes: 422 'una sola variable')",
    created.res.ok,
    JSON.stringify(created.json)
  );

  const remote = await api(`/api/dev/wa-mock/graph/${WABA}/message_templates`);
  const atMeta = (remote.json?.data ?? []).find((t) => t.name === name);
  const bodyComp = (atMeta?.components ?? []).find(
    (c) => (c.type ?? "").toUpperCase() === "BODY"
  );
  ok("Meta la recibió", Boolean(atMeta), JSON.stringify(remote.json));
  ok(
    "se mandó UN ejemplo por variable (si no, Meta responde 100)",
    (bodyComp?.example?.body_text?.[0] ?? []).length === 3,
    JSON.stringify(bodyComp?.example)
  );

  console.log("\n== Camino infeliz: numeración con saltos ==");
  const gap = await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name: `salto_${stamp}`,
      language: "es_MX",
      category: "UTILITY",
      body: "Hola {{1}}, tu pedido {{3}} llegó",
    }),
  });
  ok("422 con salto en la numeración", gap.res.status === 422, String(gap.res.status));
  ok(
    "el mensaje explica la regla",
    /sin saltos/.test(gap.json?.error?.message ?? ""),
    JSON.stringify(gap.json)
  );

  console.log("\n== Aprobación y conversación ==");
  await metaApproves(name);
  const sync = await api("/api/templates/sync", { method: "POST" });
  ok("sync 200", sync.res.ok, JSON.stringify(sync.json));
  const local = await findTemplate(name);
  ok("estado = approved", local?.status === "approved", local?.status);

  const inbound = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: FROM,
      name: "Lead Multivar",
      text: "Hola, quiero la sesión",
    }),
  });
  ok("inbound entregado", inbound.res.ok, JSON.stringify(inbound.json));
  const convs = await api("/api/conversations");
  const conv = (convs.json?.conversations ?? []).find(
    (c) => (c.contact?.phone ?? "").includes("5599990001")
  );
  ok("conversación creada", Boolean(conv?.id), JSON.stringify(convs.json)?.slice(0, 200));

  console.log("\n== Camino infeliz: falta un valor ==");
  const short = await api(`/api/conversations/${conv?.id}/messages/template`, {
    method: "POST",
    body: JSON.stringify({
      templateId: local?.id,
      variables: ["María", "12 de agosto"],
    }),
  });
  ok("422 si faltan valores", short.res.status === 422, String(short.res.status));
  ok(
    "dice cuál falta",
    /\{\{3\}\}/.test(short.json?.error?.message ?? ""),
    JSON.stringify(short.json)
  );

  console.log("\n== Envío con los 3 valores ==");
  const sent = await api(`/api/conversations/${conv?.id}/messages/template`, {
    method: "POST",
    body: JSON.stringify({
      templateId: local?.id,
      variables: ["María", "12 de agosto", "5:00 pm"],
    }),
  });
  ok("envío 200", sent.res.ok, JSON.stringify(sent.json));

  const out = await lastOutbound();
  const params =
    out?.body?.template?.components?.find((c) => c.type === "body")?.parameters ??
    [];
  ok("Meta recibió type=template", out?.body?.type === "template", out?.body?.type);
  ok("3 parámetros en orden", params.length === 3, JSON.stringify(params));
  ok(
    "los valores van en su posición",
    params[0]?.text === "María" &&
      params[1]?.text === "12 de agosto" &&
      params[2]?.text === "5:00 pm",
    JSON.stringify(params)
  );

  const msgs = await api(`/api/conversations/${conv?.id}/messages`);
  const list = msgs.json?.messages ?? [];
  const tplMsg = [...list].reverse().find((m) => m.type === "template");
  ok(
    "el hilo muestra el texto ya sustituido",
    tplMsg?.text?.includes("Hola María") &&
      tplMsg?.text?.includes("12 de agosto a las 5:00 pm"),
    tplMsg?.text
  );

  console.log("\n== Compatibilidad: plantilla de UNA variable con `variable` ==");
  const oneName = `una_var_${stamp}`;
  const one = await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name: oneName,
      language: "es_MX",
      category: "UTILITY",
      body: "Hola {{1}} 👋 ¿Retomamos tu cotización?",
    }),
  });
  ok("alta de una variable sigue OK", one.res.ok, JSON.stringify(one.json));
  await metaApproves(oneName);
  await api("/api/templates/sync", { method: "POST" });
  const oneLocal = await findTemplate(oneName);
  const legacy = await api(`/api/conversations/${conv?.id}/messages/template`, {
    method: "POST",
    body: JSON.stringify({ templateId: oneLocal?.id, variable: "María" }),
  });
  ok("el payload viejo {variable} sigue enviando", legacy.res.ok, JSON.stringify(legacy.json));
  const outOne = await lastOutbound();
  const paramsOne =
    outOne?.body?.template?.components?.find((c) => c.type === "body")
      ?.parameters ?? [];
  ok("1 parámetro", paramsOne.length === 1 && paramsOne[0]?.text === "María", JSON.stringify(paramsOne));

  console.log(
    `\n${failures === 0 ? "TODO VERDE" : "CON FALLOS"} — ${checks - failures}/${checks} checks`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
