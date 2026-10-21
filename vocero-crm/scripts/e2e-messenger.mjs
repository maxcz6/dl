/**
 * Self-test E2E de comportamiento — 017: canal de Messenger.
 *
 * Conduce la app real en localhost con los mocks: conecta la página por las
 * DOS fuentes (Meta directo y Zernio), mete mensajes por el webhook como lo
 * haría cada proveedor y responde desde la bandeja, comprobando cada paso por
 * las mismas superficies que usa el operador.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      ZERNIO_BASE_URL → zernio-mock, CHANNELS con messenger, y BD migrada
 *   2) node --env-file=.env scripts/e2e-messenger.mjs
 *
 * Sale con código 1 si algún check falla.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
const PAGE = "page-demo-001";
const ACCOUNT = "zernio-account-001";
const SECRET = "secreto-del-webhook-de-zernio";
const RUN = Date.now().toString(36);
const PSID_META = `psid-meta-${RUN}`;
const PSID_ZERNIO = `psid-zernio-${RUN}`;
/** Marca de esta corrida: el arnes se puede repetir sobre la misma base. */
const MARCA = `#${RUN}`;
const NOMBRE_ZERNIO = `Jane Doe ${MARCA}`;

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

/** El proveedor entrega por POST sin cookies; la ruta lleva el segmento secreto. */
async function webhook(payload, { token = VERIFY_TOKEN, signature } = {}) {
  const body = JSON.stringify(payload);
  return fetch(`${BASE}/api/webhooks/messenger/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-zernio-signature": signature } : {}),
    },
    body,
  });
}

const sign = (payload, secret = SECRET) =>
  createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");

function metaEvent(messaging) {
  return { object: "page", entry: [{ id: PAGE, time: Date.now(), messaging }] };
}

function zernioEvent(over = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    event: "message.received",
    message: {
      id: `zmsg-${Math.random().toString(36).slice(2)}`,
      conversationId: "zconv-001",
      direction: "incoming",
      text: "Hola desde Facebook",
      sender: { id: PSID_ZERNIO, name: NOMBRE_ZERNIO, username: "jane_doe" },
      ...(over.message ?? {}),
    },
    account: { id: ACCOUNT, platform: "facebook", ...(over.account ?? {}) },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !["message", "account"].includes(k))),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** La ingesta corre tras responder el webhook: se espera a que aparezca. */
async function waitForConversation(pred, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const { json } = await api("/api/conversations");
    const found = (json?.conversations ?? []).find(pred);
    if (found) return found;
    await sleep(300);
  }
  return null;
}

async function main() {
  if (!VERIFY_TOKEN) {
    console.error("Falta META_WEBHOOK_VERIFY_TOKEN en el entorno");
    process.exit(1);
  }

  console.log("== Setup: registro/login del propietario ==");
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
  ok("registro o login del propietario", su.res.ok);

  console.log("\n== Webhook: capas de seguridad ==");
  const wrong = await webhook(metaEvent([]), { token: "token-equivocado" });
  ok("segmento secreto equivocado → 404 sin efectos", wrong.status === 404, String(wrong.status));
  const hs = await fetch(
    `${BASE}/api/webhooks/messenger/${VERIFY_TOKEN}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=reto-123`
  );
  ok("handshake de Meta devuelve el challenge", hs.status === 200 && (await hs.text()) === "reto-123");

  // ------------------------------------------------------------------
  console.log("\n===== FUENTE: META DIRECTO =====");
  console.log("\n== Conexión de la página (validada contra Graph) ==");
  const bad = await api("/api/settings/messenger", {
    method: "PUT",
    body: JSON.stringify({ source: "meta", pageId: PAGE, token: "token-invalid" }),
  });
  ok("un token que Meta rechaza NO se guarda → 422", bad.res.status === 422, String(bad.res.status));

  const conn = await api("/api/settings/messenger", {
    method: "PUT",
    body: JSON.stringify({ source: "meta", pageId: PAGE, token: "token-pagina-demo" }),
  });
  ok(
    "PUT con token válido → 200 con el nombre de la página",
    conn.res.ok && conn.json?.pageName === "Página de prueba Vocero",
    JSON.stringify(conn.json)
  );

  const state = await api("/api/settings/messenger");
  ok(
    "GET enseña la conexión sin el token entero (solo su cola)",
    state.json?.connection?.status === "connected" &&
      state.json?.connection?.source === "meta" &&
      state.json?.connection?.tokenLast4 === "demo" &&
      !JSON.stringify(state.json).includes("token-pagina-demo")
  );

  const wh = await api("/api/settings/webhook");
  ok(
    "la pantalla tiene la URL del webhook de Messenger con el segmento secreto",
    typeof wh.json?.messengerUrl === "string" &&
      wh.json.messengerUrl.endsWith(`/api/webhooks/messenger/${VERIFY_TOKEN}`)
  );

  console.log("\n== Entrante por Meta ==");
  const first = await webhook(
    metaEvent([
      {
        sender: { id: PSID_META },
        recipient: { id: PAGE },
        timestamp: Date.now(),
        message: { mid: `m_${PSID_META}_1`, text: `Hola, ¿tienen envíos a Guadalajara? ${MARCA}` },
      },
    ])
  );
  ok("el proveedor recibe 200 de inmediato", first.status === 200);
  const convMeta = await waitForConversation((c) => c.preview?.includes(MARCA));
  ok("la conversación aparece en la bandeja", Boolean(convMeta));
  ok("con canal messenger", convMeta?.channel === "messenger", convMeta?.channel);
  ok(
    "el contacto tiene nombre de perfil (consultado a Graph), no el PSID crudo",
    convMeta?.contact?.name === "Cliente de Messenger",
    convMeta?.contact?.name
  );
  ok("el contacto no tiene teléfono", convMeta?.contact?.phone == null);
  ok("la ventana de 24 h abre con el entrante", convMeta?.windowOpen === true);

  console.log("\n== Idempotencia y ruido (Meta) ==");
  await webhook(
    metaEvent([{ sender: { id: PSID_META }, message: { mid: `m_${PSID_META}_1`, text: `Hola, ¿tienen envíos a Guadalajara? ${MARCA}` } }])
  );
  await webhook(
    metaEvent([
      { sender: { id: PAGE }, recipient: { id: PSID_META }, message: { mid: `m_echo`, text: "eco", is_echo: true } },
      { sender: { id: PSID_META }, delivery: { mids: ["m_1"], watermark: Date.now() } },
      { sender: { id: PSID_META }, read: { watermark: Date.now() } },
    ])
  );
  await webhook(
    metaEvent([
      { sender: { id: PSID_META }, message: { mid: `m_${PSID_META}_img`, attachments: [{ type: "image", payload: { url: "https://cdn.example/x.jpg" } }] } },
    ])
  );
  await sleep(1500);
  const msgs = await api(`/api/conversations/${convMeta?.id}/messages`);
  const inbound = (msgs.json?.messages ?? []).filter((m) => m.direction === "in");
  ok(
    "el webhook repetido NO duplica el mensaje",
    inbound.filter((m) => m.text?.includes(MARCA)).length === 1,
    `in=${inbound.length}`
  );
  ok("echo, acuses y lectura no crean mensajes", inbound.every((m) => m.text !== "eco"));
  ok("un adjunto entra con su tipo (imagen)", inbound.some((m) => m.type === "image"), inbound.map((m) => m.type).join(","));

  console.log("\n== Salida por Meta ==");
  const beforeWa = await fetch(`${BASE}/api/dev/wa-mock/outbox`).then((r) => r.json());
  const replyMeta = await api(`/api/conversations/${convMeta?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "Sí, a toda la zona metropolitana." }),
  });
  ok("POST /messages → 200/201", replyMeta.res.ok, JSON.stringify(replyMeta.json));
  const afterWa = await fetch(`${BASE}/api/dev/wa-mock/outbox`).then((r) => r.json());
  const sentWa = (afterWa.outbox ?? []).slice((beforeWa.outbox ?? []).length);
  const lastWa = sentWa[sentWa.length - 1];
  ok("salió por la página, no por el número de WhatsApp", lastWa?.phoneNumberId === PAGE, JSON.stringify(lastWa));
  ok(
    "al PSID correcto y como RESPONSE dentro de la ventana",
    lastWa?.body?.recipient?.id === PSID_META && lastWa?.body?.messaging_type === "RESPONSE"
  );
  const msgsOut = await api(`/api/conversations/${convMeta?.id}/messages`);
  const out = (msgsOut.json?.messages ?? []).find((m) => m.direction === "out");
  ok("el saliente queda como 'sent' (Messenger no manda acuses)", out?.status === "sent", out?.status);

  console.log("\n== Lo que Messenger no admite falla claro ==");
  const loc = await api(`/api/conversations/${convMeta?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ type: "location", location: { latitude: 20.67, longitude: -103.35 } }),
  });
  ok("una ubicación por Messenger → error claro, no 500", loc.res.status >= 400 && loc.res.status < 500, String(loc.res.status));
  const long = await api(`/api/conversations/${convMeta?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: "x".repeat(2001) }),
  });
  ok("un texto de más de 2000 bytes → rechazado antes de tocar Meta", long.res.status >= 400 && long.res.status < 500, String(long.res.status));

  // ------------------------------------------------------------------
  console.log("\n===== FUENTE: ZERNIO =====");
  await fetch(`${BASE}/api/dev/zernio-mock/_reset`, { method: "POST" });
  // 023: la cuenta se resuelve contra las de la llave; el simulador las sirve.
  await api("/api/dev/zernio-mock/_accounts", {
    method: "POST",
    body: JSON.stringify({
      accounts: [
        {
          _id: ACCOUNT,
          platform: "facebook",
          displayName: "Página Demo",
          isActive: true,
          platformStatus: "active",
          metadata: { selectedPageId: PAGE, selectedPageName: "Página Demo" },
        },
      ],
    }),
  });
  await api("/api/dev/zernio-mock/_webhooks", {
    method: "POST",
    body: JSON.stringify({ webhooks: [] }),
  });

  console.log("\n== Conexión por Zernio (validada contra su API) ==");
  const badZ = await api("/api/settings/messenger", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: ACCOUNT, token: "sk_test-invalid" }),
  });
  ok("una API key que Zernio rechaza NO se guarda → 422", badZ.res.status === 422, String(badZ.res.status));

  // 023: sin accountId ya no es un error (se toma la única página de la
  // llave; lo cubre e2e-canales). Lo que no se guarda es una cuenta ajena.
  const noAccount = await api("/api/settings/messenger", {
    method: "PUT",
    body: JSON.stringify({ source: "zernio", accountRef: "no-es-de-esta-llave", token: "sk_test-ok" }),
  });
  ok(
    "un accountId que no es de una página de esa llave → 422 unknown_account",
    noAccount.res.status === 422 && noAccount.json?.error?.code === "unknown_account",
    `${noAccount.res.status} ${JSON.stringify(noAccount.json)}`
  );

  const connZ = await api("/api/settings/messenger", {
    method: "PUT",
    body: JSON.stringify({
      source: "zernio",
      accountRef: ACCOUNT,
      token: "sk_test-ok",
      webhookSecret: SECRET,
    }),
  });
  ok("PUT con API key válida → 200", connZ.res.ok, JSON.stringify(connZ.json));
  const stateZ = await api("/api/settings/messenger");
  ok(
    "la conexión queda en modo zernio con su cuenta",
    stateZ.json?.connection?.source === "zernio" && stateZ.json?.connection?.accountRef === ACCOUNT,
    JSON.stringify(stateZ.json?.connection)
  );

  console.log("\n== Firma del webhook de Zernio ==");
  const evtFirma = zernioEvent();
  const sinFirma = await webhook(evtFirma);
  ok("sin firma con secreto configurado → 401", sinFirma.status === 401, String(sinFirma.status));
  const malFirmada = await webhook(evtFirma, { signature: "deadbeef" });
  ok("firma inválida → 401", malFirmada.status === 401, String(malFirmada.status));

  console.log("\n== Entrante por Zernio ==");
  const evt = zernioEvent();
  const okFirma = await webhook(evt, { signature: sign(evt) });
  ok("firma válida → 200", okFirma.status === 200, String(okFirma.status));
  const convZ = await waitForConversation((c) => c.contact?.name === NOMBRE_ZERNIO);
  ok("la conversación aparece en la bandeja", Boolean(convZ));
  ok("con canal messenger", convZ?.channel === "messenger", convZ?.channel);
  ok("el nombre viene del evento, sin consultar a nadie", convZ?.contact?.name === NOMBRE_ZERNIO, convZ?.contact?.name);

  console.log("\n== Zernio: ruido de otras plataformas y duplicados ==");
  const otra = zernioEvent({
    account: { platform: "instagram" },
    message: { id: "zmsg-ig", text: "esto es de instagram", sender: { id: "igsid-x", name: "Otro" } },
  });
  await webhook(otra, { signature: sign(otra) });
  const dup = { ...evt };
  await webhook(dup, { signature: sign(dup) });
  const salida = zernioEvent({ message: { id: "zmsg-out", direction: "outgoing", text: "respuesta mía" } });
  await webhook(salida, { signature: sign(salida) });
  await sleep(1500);
  const msgsZ = await api(`/api/conversations/${convZ?.id}/messages`);
  const inZ = (msgsZ.json?.messages ?? []).filter((m) => m.direction === "in");
  ok("el evento repetido NO duplica el mensaje", inZ.length === 1, `in=${inZ.length}`);
  const todas = await api("/api/conversations");
  ok(
    "un mensaje de Instagram por el mismo webhook NO entra como Messenger",
    !(todas.json?.conversations ?? []).some((c) => c.preview?.includes("esto es de instagram"))
  );
  ok(
    "un `outgoing` de la bandeja de Zernio no se ingiere como entrante",
    !inZ.some((m) => m.text === "respuesta mía")
  );

  console.log("\n== Zernio: defensa entre fuentes ==");
  const metaMientrasZernio = await webhook(
    metaEvent([{ sender: { id: "psid-intruso" }, message: { mid: "m_intruso", text: "payload de meta" } }])
  );
  await sleep(1000);
  const trasIntruso = await api("/api/conversations");
  ok(
    "un payload de Meta con la instancia en modo Zernio se descarta",
    metaMientrasZernio.status === 200 &&
      !(trasIntruso.json?.conversations ?? []).some((c) => c.preview?.includes("payload de meta"))
  );

  console.log("\n== Salida por Zernio ==");
  const replyZ = await api(`/api/conversations/${convZ?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: `Claro, te mando el catálogo ${MARCA}` }),
  });
  ok("POST /messages → 200/201", replyZ.res.ok, JSON.stringify(replyZ.json));
  const sentZ = await fetch(`${BASE}/api/dev/zernio-mock/_sent`).then((r) => r.json());
  const lastZ = (sentZ.sent ?? [])[sentZ.sent.length - 1];
  ok("salió por la API de Zernio", Boolean(lastZ), JSON.stringify(sentZ).slice(0, 200));
  ok(
    "a la conversación del evento (el conversationId opaco), con su accountId",
    lastZ?.conversationId === "zconv-001" && lastZ?.accountId === ACCOUNT,
    JSON.stringify(lastZ)
  );
  ok("con el texto que escribió el operador", lastZ?.message === `Claro, te mando el catálogo ${MARCA}`);
  ok(
    "dentro de la ventana NO va etiquetado como agente humano",
    !lastZ?.messageTag,
    JSON.stringify(lastZ?.messageTag)
  );
  const msgsZ2 = await api(`/api/conversations/${convZ?.id}/messages`);
  const outZ = (msgsZ2.json?.messages ?? []).find((m) => m.direction === "out");
  ok("el saliente queda como 'sent'", outZ?.status === "sent", outZ?.status);

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR FATAL:", err);
  process.exit(1);
});
