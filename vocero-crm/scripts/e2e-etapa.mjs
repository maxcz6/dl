/**
 * Self-test E2E de comportamiento — 038: el cerebro mueve la etapa.
 *
 * Conduce la app real con el cerebro falso (`scripts/lib/cerebro-falso.mjs`):
 * un WhatsApp entra por el wa-mock, el CRM lo despacha, el cerebro falso lee
 * `lead.nextStages` del contexto y mueve al lead con `POST /api/bot/stage`.
 * Luego prueba las reglas directo contra la ruta: idempotencia, hacia atrás,
 * cierre, nombres que no existen, herramienta apagada y pausa.
 *
 * Uso:
 *   1) La app con la configuración estándar de los guiones (ver
 *      `scripts/lib/cerebro-falso.mjs`): WA_MOCK_ENABLED, BOT_API_KEY,
 *      BRAIN_DISPATCH_URL, AGENT_COALESCE_MS corto.
 *   2) node --env-file=.env.e2e-036 scripts/e2e-etapa.mjs
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-etapa.md.
 */
import postgres from "postgres";
import {
  apagarAgente,
  encenderAgente,
  levantarCerebroFalso,
  urlDelDespacho,
} from "./lib/cerebro-falso.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const MARCA = `#${RUN}`;
const DIGITOS = String(Date.now() % 1_000_000).padStart(6, "0");
const telefono = (n) => `52155${DIGITOS}${String(n).padStart(2, "0")}`;

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

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
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

/** Lo que haría un cerebro: con la llave y sin sesión. */
async function bot(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", "x-api-key": BOT_KEY, ...(opts.headers ?? {}) },
  });
  return { res, json: await res.json().catch(() => null) };
}

const mover = (conversationId, stage, headers) =>
  bot("/api/bot/stage", { method: "POST", body: JSON.stringify({ conversationId, stage }), headers });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(cond, ms = 20000, paso = 250) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > fin) return null;
    await sleep(paso);
  }
}

let nMensaje = 0;
const entranteWa = (from, name, text) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from, name, text, waMessageId: `wamid.etapa.${RUN}.${++nMensaje}` }),
  });

const convDe = (name) =>
  hasta(async () =>
    ((await api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact.name === name)
  );

const tablero = async () => (await api("/api/pipeline/board")).json;

const eventosDe = (leadId) =>
  sql`select from_stage_name, to_stage_name, source from lead_stage_event
      where lead_id = ${leadId} order by occurred_at, id`;

async function preparar() {
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("conexión de WhatsApp guardada (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  // El Calificador enciende todas sus herramientas, `etapa` incluida.
  const preset = await api("/api/agent/profile/preset", { method: "POST", body: JSON.stringify({ role: "calificador" }) });
  ok("preset Calificador cargado", preset.res.ok, JSON.stringify(preset.json));
}

async function guion(cerebro) {
  console.log("== Setup ==");
  await preparar();
  const p = (await api("/api/agent/profile")).json;
  ok("la pantalla Agente ofrece «Mover de etapa» encendida", p?.profile?.tools?.includes("etapa"), JSON.stringify(p?.profile?.tools));
  const b = (await bot("/api/bot/profile")).json;
  ok("AC6: el cerebro ve `etapa` en tools", b?.profile?.tools?.includes("etapa"), JSON.stringify(b?.profile?.tools));

  const board0 = await tablero();
  const etapas = [...(board0?.stages ?? [])].sort((a, b) => a.position - b.position);
  const abiertas = etapas.filter((s) => s.kind === "open");
  const ganada = etapas.find((s) => s.kind === "won");
  const perdida = etapas.find((s) => s.kind === "lost");
  if (abiertas.length < 3 || !ganada || !perdida) {
    ok("el pipeline tiene 3 abiertas, una ganada y una perdida", false, JSON.stringify(etapas));
    return;
  }
  const [primera, segunda, tercera] = abiertas;

  const enc = await encenderAgente(api);
  ok("interruptor del Agente encendido (cerebro falso sano)", enc.res.ok, JSON.stringify(enc.json));

  console.log("\n== AC8: un WhatsApp real, el cerebro lee el contexto y mueve al lead ==");
  const nombre = `Rita Califica ${MARCA}`;
  await entranteWa(telefono(1), nombre, `ya califica, quiero una cotización ${MARCA}`);
  const conv = await convDe(nombre);
  ok("la conversación entró a la bandeja", Boolean(conv));
  if (!conv) return;
  const movida = await hasta(() => cerebro.respuestasDe(conv.id).find((r) => r.tipo === "etapa"));
  ok("el cerebro llamó a POST /api/bot/stage", Boolean(movida));
  ok(
    "→ 200 changed: true, a la siguiente abierta",
    movida?.status === 200 && movida.json?.changed === true && movida.json?.lead?.stageName === segunda.name,
    JSON.stringify(movida)
  );
  const ctx = cerebro.estado.contextos.find((c) => c.convId === conv.id);
  ok(
    "AC5: el contexto le dio las abiertas siguientes, en orden",
    JSON.stringify(ctx?.nextStages?.map((s) => s.name)) ===
      JSON.stringify(abiertas.slice(1).map((s) => s.name)),
    JSON.stringify(ctx)
  );
  const respondio = await hasta(() =>
    cerebro.respuestasDe(conv.id).find((r) => r.tipo === "mensaje" && r.status === 200)
  );
  ok("y además contestó al cliente", Boolean(respondio), JSON.stringify(cerebro.respuestasDe(conv.id)));

  const lead = (await tablero())?.leads?.find((l) => l.conversationId === conv.id);
  ok("el Pipeline lo enseña en la etapa nueva", lead?.stageId === segunda.id, JSON.stringify(lead));
  if (!lead) return;
  let eventos = await eventosDe(lead.id);
  ok(
    "la bitácora de etapas dice que lo movió el bot",
    eventos.at(-1)?.source === "bot" &&
      eventos.at(-1)?.from_stage_name === primera.name &&
      eventos.at(-1)?.to_stage_name === segunda.name,
    JSON.stringify(eventos)
  );

  console.log("\n== AC2: repetir es inocuo ==");
  const n = eventos.length;
  const otra = await mover(conv.id, segunda.name.toUpperCase());
  ok("misma etapa (en mayúsculas) → 200 changed: false", otra.res.status === 200 && otra.json?.changed === false, JSON.stringify(otra.json));
  eventos = await eventosDe(lead.id);
  ok("sin evento nuevo en la bitácora", eventos.length === n, String(eventos.length));

  console.log("\n== AC3: lo que no puede ==");
  for (const [caso, etapa] of [
    ["hacia atrás", primera.name],
    ["a ganada", ganada.name],
    ["a perdida", perdida.name],
  ]) {
    const r = await mover(conv.id, etapa);
    ok(
      `${caso} → 409 etapa_no_permitida, con las válidas en el mensaje`,
      r.res.status === 409 && r.json?.error?.code === "etapa_no_permitida" && r.json.error.message.includes(tercera.name),
      JSON.stringify(r.json)
    );
  }
  const desconocida = await mover(conv.id, `No existe ${MARCA}`);
  ok("una etapa que no existe → 422 etapa_desconocida", desconocida.res.status === 422 && desconocida.json?.error?.code === "etapa_desconocida", JSON.stringify(desconocida.json));
  const sinConv = await mover("cv_no_existe", segunda.name);
  ok("conversación inexistente → 404", sinConv.res.status === 404, JSON.stringify(sinConv.json));
  const sinLlave = await mover(conv.id, tercera.name, { "x-api-key": "llave-equivocada-123456" });
  ok("sin la llave → 401", sinLlave.res.status === 401);
  const vacio = await bot("/api/bot/stage", { method: "POST", body: JSON.stringify({ conversationId: conv.id }) });
  ok("sin `stage` → 422", vacio.res.status === 422);
  ok("el lead sigue donde estaba", (await tablero())?.leads?.find((l) => l.id === lead.id)?.stageId === segunda.id);

  console.log("\n== AC4: con la herramienta apagada ==");
  const apagar = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ tools: ["ficha", "salida"] }) });
  ok("apagar «Mover de etapa» desde la pantalla Agente", apagar.res.ok, JSON.stringify(apagar.json));
  const b2 = (await bot("/api/bot/profile")).json;
  ok("AC6: una lista explícita sin `etapa` no la trae", !b2?.profile?.tools?.includes("etapa"), JSON.stringify(b2?.profile?.tools));
  const apagada = await mover(conv.id, tercera.name);
  ok("→ 409 herramienta_apagada", apagada.res.status === 409 && apagada.json?.error?.code === "herramienta_apagada", JSON.stringify(apagada.json));
  ok("y el lead no se movió", (await tablero())?.leads?.find((l) => l.id === lead.id)?.stageId === segunda.id);
  await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ tools: ["ficha", "etapa", "salida"] }) });
  const encendida = await mover(conv.id, tercera.id);
  ok("encendida otra vez, se mueve (por id)", encendida.res.status === 200 && encendida.json?.changed === true, JSON.stringify(encendida.json));
  const ctxFinal = (await bot(`/api/bot/context?conversationId=${conv.id}`)).json;
  ok("AC5: en la última abierta, nextStages viene vacía", (Array.isArray(ctxFinal?.lead?.nextStages) && ctxFinal.lead.nextStages.length === 0) || abiertas.length > 3, JSON.stringify(ctxFinal?.lead));

  console.log("\n== D6: con una persona al frente ==");
  const nombre2 = `Paco Pausa ${MARCA}`;
  await entranteWa(telefono(2), nombre2, `hola ${MARCA}`);
  const conv2 = await convDe(nombre2);
  await hasta(() => cerebro.respuestasDe(conv2?.id).find((r) => r.tipo === "mensaje"));
  const ho = await bot("/api/bot/handoff", { method: "POST", body: JSON.stringify({ conversationId: conv2?.id, reason: "cliente" }) });
  ok("handoff hecho", ho.res.ok);
  const pausada = await mover(conv2?.id, segunda.name);
  ok("→ 409 ai_paused", pausada.res.status === 409 && pausada.json?.error?.code === "ai_paused", JSON.stringify(pausada.json));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL (la bitácora de etapas se lee de la base).");
    process.exit(2);
  }
  const url = urlDelDespacho();
  const cerebro = await levantarCerebroFalso({ base: BASE, botKey: BOT_KEY, url, responder: "todas" });
  try {
    await guion(cerebro);
  } finally {
    // Como lo dejaría una instalación: todas las herramientas y el
    // interruptor apagado para el siguiente guion.
    if (cookie) {
      await api("/api/agent/profile/preset", { method: "POST", body: JSON.stringify({ role: "calificador" }) }).catch(() => {});
      await apagarAgente(api).catch(() => {});
    }
    await cerebro.esperar();
    await cerebro.apagar().catch(() => {});
    await sql.end();
  }
  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
