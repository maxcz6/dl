/**
 * Self-test E2E de comportamiento — 024: texto del agente en redes y ventana
 * de atención humana.
 *
 * Conduce la app real con los simuladores: mete mensajes por el webhook como
 * lo haría Zernio (con la fecha que haga falta para envejecer la ventana),
 * contesta como cerebro (`/api/bot/messages`) y como persona (la bandeja), y
 * comprueba lo que salió hacia cada plataforma y lo que quedó en el hilo.
 *
 * 036 — La última parte ya no enciende un agente incluido: contesta el
 * cerebro falso (`scripts/lib/cerebro-falso.mjs`) por el despacho, pensando
 * por `/api/bot/llm`. La primera parte corre con el interruptor apagado: con
 * el despacho configurado, así no se despacha nada y solo sale lo que manda
 * el guion.
 *
 * Uso (configuración estándar de la 036, ver `scripts/lib/cerebro-falso.mjs`):
 *   1) app corriendo (`pnpm dev`) sobre una base migrada, con
 *      BRAIN_DISPATCH_URL=http://127.0.0.1:3261/vocero/dispatch,
 *      CHANNELS=whatsapp,instagram,messenger,tiktok, WA_MOCK_ENABLED=true,
 *      META_GRAPH_BASE_URL → wa-mock, ZERNIO_BASE_URL → zernio-mock,
 *      OPENROUTER_BASE_URL → ai-mock con OPENROUTER_API_TOKEN y
 *      OPENROUTER_MODEL, BOT_API_KEY y AGENT_COALESCE_MS=1500.
 *   2) node --env-file=.env.e2e-036 scripts/e2e-ventana-social.mjs
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-ventana-social.md.
 */
import { createHmac } from "node:crypto";
import { apagarAgente, encenderAgente, levantarCerebroFalso } from "./lib/cerebro-falso.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const COALESCE = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const CHANNELS = (process.env.CHANNELS ?? "").split(",").map((c) => c.trim());
const RUN = Date.now().toString(36);
const MARCA = `#${RUN}`;
const SECRET = "secreto-del-webhook-de-zernio";
const LLAVE = "sk_llave-de-zernio-ventana";
const PN = "PN-E2E-1";
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const CUENTA = { ig: `ig-vs-${RUN}`, fb: `fb-vs-${RUN}`, tt: `tt-vs-${RUN}` };
const PLATAFORMA = { ig: "instagram", fb: "facebook", tt: "tiktok" };
const CANAL = { ig: "instagram", fb: "messenger", tt: "tiktok" };

// Lo que escribe una IA: formato de WhatsApp y Markdown mezclados.
const CON_FORMATO = (m) =>
  `*Hola* ${m}\n**Horario:** de _9 a 6_\n- Martillos\n- ~Clavos~ agotados\nMira el [catálogo](https://tienda.mx/cat_2026)`;
const PLANO = (m) =>
  `Hola ${m}\nHorario: de 9 a 6\n• Martillos\n• Clavos agotados\nMira el catálogo: https://tienda.mx/cat_2026`;

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

const bot = (path, opts = {}) =>
  api(path, { ...opts, headers: { "x-api-key": BOT_KEY, ...(opts.headers ?? {}) } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(cond, ms = 15000, paso = 200) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > fin) return null;
    await sleep(paso);
  }
}

// ---------------------------------------------------------------------------

let nEvento = 0;
/** Un `message.received` de Zernio; `hace` envejece el mensaje del cliente. */
async function entranteSocial(red, { sender, nombre, text, hace = 0 }) {
  nEvento++;
  const hilo = `zconv-vs-${red}-${sender}`;
  const cuerpo = JSON.stringify({
    id: `evt-vs-${RUN}-${nEvento}`,
    event: "message.received",
    message: {
      id: `zmsg-vs-${RUN}-${nEvento}`,
      conversationId: hilo,
      platform: PLATAFORMA[red],
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: sender, name: nombre, username: null },
      sentAt: new Date(Date.now() - hace).toISOString(),
    },
    conversation: { id: hilo },
    account: { id: CUENTA[red], accountId: CUENTA[red], platform: PLATAFORMA[red] },
  });
  const res = await fetch(`${BASE}/api/webhooks/ig/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": createHmac("sha256", SECRET).update(cuerpo).digest("hex"),
    },
    body: cuerpo,
  });
  return { status: res.status, hilo };
}

let nWa = 0;
const entranteWa = (from, name, text) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.vs.${RUN}.${++nWa}`,
    }),
  });

const conversaciones = async () => (await api("/api/conversations")).json?.conversations ?? [];
// La ingesta corre tras responder el webhook y sella `lastInboundAt` al final:
// se espera a la conversación YA con su último entrante, que es de lo que
// depende la ventana.
const convDe = (nombre) =>
  hasta(async () =>
    (await conversaciones()).find((c) => c.contact.name === nombre && c.lastInboundAt !== null)
  );
const mensajesDe = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
const enviadosPorZernio = async (hilo) =>
  ((await api("/api/dev/zernio-mock/_sent")).json?.sent ?? []).filter((m) => m.conversationId === hilo);
const comoCerebro = (conversationId, text) =>
  bot("/api/bot/messages", { method: "POST", body: JSON.stringify({ conversationId, text }) });
const aMano = (conversationId, text) =>
  api(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) });

/** Abre una conversación social con un mensaje del cliente de hace `hace` ms. */
async function conversacion(red, etiqueta, hace = 0) {
  const sender = `${red}-${etiqueta}-${RUN}`;
  const nombre = `Cliente ${red} ${etiqueta} ${MARCA}`;
  const e = await entranteSocial(red, { sender, nombre, text: `hola ${etiqueta} ${MARCA}`, hace });
  const conv = e.status === 200 ? await convDe(nombre) : null;
  return { conv, hilo: e.hilo, sender, nombre, status: e.status };
}

// ---------------------------------------------------------------------------

async function main() {
  for (const c of ["instagram", "messenger", "tiktok"]) {
    if (!CHANNELS.includes(c)) {
      console.error(`CHANNELS no incluye \`${c}\`: arranca la app con los tres canales sociales.`);
      process.exit(1);
    }
  }
  if (!BOT_KEY) {
    console.error("Falta BOT_API_KEY: el guion contesta como cerebro por /api/bot/messages.");
    process.exit(1);
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
  ok("registro o login del propietario", su.res.ok, JSON.stringify(su.json));

  await api("/api/dev/zernio-mock/_reset", { method: "POST" });
  await api("/api/dev/zernio-mock/_accounts", {
    method: "POST",
    body: JSON.stringify({
      accounts: [
        { _id: CUENTA.ig, platform: "instagram", username: "negocio.ig", platformUserId: `1784${RUN}`, isActive: true, platformStatus: "active" },
        { _id: CUENTA.fb, platform: "facebook", displayName: "Negocio Demo", isActive: true, platformStatus: "active", metadata: { selectedPageId: `page-${RUN}`, selectedPageName: "Negocio Demo" } },
        { _id: CUENTA.tt, platform: "tiktok", username: "negocio.tt", isActive: true, platformStatus: "active", tiktokAccountType: "business" },
      ],
    }),
  });
  await api("/api/dev/zernio-mock/_webhooks", { method: "POST", body: JSON.stringify({ webhooks: [] }) });
  const conexiones = [];
  for (const [canal, cuerpo] of [
    ["instagram", { source: "zernio", token: LLAVE, webhookSecret: SECRET }],
    ["messenger", { source: "zernio", token: LLAVE, webhookSecret: SECRET }],
    ["tiktok", { token: LLAVE, webhookSecret: SECRET }],
  ]) {
    conexiones.push((await api(`/api/settings/${canal}`, { method: "PUT", body: JSON.stringify(cuerpo) })).res.ok);
  }
  ok("Instagram, Messenger y TikTok conectados por Zernio (simulador)", conexiones.every(Boolean), JSON.stringify(conexiones));
  const wa = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("WhatsApp conectado (wa-mock)", wa.res.ok, JSON.stringify(wa.json));
  // Apagado mientras el guion hace de cerebro: así solo sale lo que él manda.
  ok("interruptor del Agente apagado para la primera parte", (await apagarAgente(api)).res.ok);

  await textoPlano();
  await ventanaHumana();
  await agenteContesta();

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// D1 — En redes, el texto de la IA sale plano
// ---------------------------------------------------------------------------

async function textoPlano() {
  console.log("\n== D1: el texto de la IA sale plano en redes ==");
  for (const red of ["ig", "fb", "tt"]) {
    const { conv, hilo } = await conversacion(red, "formato");
    if (!conv) {
      ok(`${CANAL[red]}: la conversación se abrió`, false);
      continue;
    }
    const marca = `${red} ${MARCA}`;
    const r = await comoCerebro(conv.id, CON_FORMATO(marca));
    ok(`${CANAL[red]}: el cerebro contesta → 200`, r.res.ok, `${r.res.status} ${JSON.stringify(r.json)}`);
    const salio = (await enviadosPorZernio(hilo)).at(-1);
    ok(
      `${CANAL[red]}: a la plataforma llega sin asteriscos, con viñetas y el enlace legible`,
      salio?.message === PLANO(marca),
      JSON.stringify(salio?.message)
    );
    const guardado = (await mensajesDe(conv.id)).filter((m) => m.direction === "out").at(-1);
    ok(
      `${CANAL[red]}: en el hilo queda lo mismo que leyó el cliente, marcado como IA`,
      guardado?.text === PLANO(marca) && guardado?.aiGenerated === true,
      JSON.stringify(guardado?.text)
    );
  }

  const { conv: convIg, hilo: hiloIg } = await conversacion("ig", "operador");
  const aManoTexto = `*esto* lo escribí _yo_ ${MARCA}`;
  const m = await aMano(convIg.id, aManoTexto);
  ok("Instagram: lo que escribe una persona sale → 200", m.res.ok, `${m.res.status} ${JSON.stringify(m.json)}`);
  ok(
    "y sale tal cual lo escribió, con sus asteriscos",
    (await enviadosPorZernio(hiloIg)).at(-1)?.message === aManoTexto,
    JSON.stringify((await enviadosPorZernio(hiloIg)).at(-1)?.message)
  );

  const nombreWa = `Cliente wa formato ${MARCA}`;
  const tel = `52155${String(Date.now() % 1_000_000).padStart(6, "0")}77`;
  await entranteWa(tel, nombreWa, `hola por whatsapp ${MARCA}`);
  const convWa = await convDe(nombreWa);
  const marcaWa = `wa ${MARCA}`;
  const rWa = await comoCerebro(convWa.id, CON_FORMATO(marcaWa));
  ok("WhatsApp: el cerebro contesta → 200", rWa.res.ok, `${rWa.res.status} ${JSON.stringify(rWa.json)}`);
  const outbox = JSON.stringify((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []);
  ok(
    "WhatsApp: el texto sale con su formato, sin tocar",
    outbox.includes(JSON.stringify(CON_FORMATO(marcaWa)).slice(1, -1)),
    ""
  );
  const guardadoWa = (await mensajesDe(convWa.id)).filter((x) => x.direction === "out").at(-1);
  ok("WhatsApp: y así queda en el hilo", guardadoWa?.text === CON_FORMATO(marcaWa), JSON.stringify(guardadoWa?.text));
}

// ---------------------------------------------------------------------------
// D2–D4 — La ventana de atención humana
// ---------------------------------------------------------------------------

async function ventanaHumana() {
  console.log("\n== D3: quién puede escribir pasadas 24 horas ==");
  for (const red of ["ig", "fb"]) {
    const canal = CANAL[red];

    // Dentro de las 24 horas: normal, sin etiqueta.
    const dentro = await conversacion(red, "23h", 23 * HORA);
    ok(
      `${canal} a las 23 h: ventana abierta y sin atención humana en la bandeja`,
      dentro.conv?.windowOpen === true && dentro.conv?.humanWindow?.open === false,
      JSON.stringify({ w: dentro.conv?.windowOpen, h: dentro.conv?.humanWindow })
    );
    await aMano(dentro.conv.id, `respuesta a tiempo ${MARCA}`);
    const sinEtiqueta = (await enviadosPorZernio(dentro.hilo)).at(-1);
    ok(
      `${canal} a las 23 h: la respuesta sale sin etiqueta`,
      sinEtiqueta && !sinEtiqueta.messageTag,
      JSON.stringify(sinEtiqueta)
    );

    // Entre 24 horas y 7 días: solo una persona, con la etiqueta.
    const en = await conversacion(red, "30h", 30 * HORA);
    const h = en.conv?.humanWindow;
    ok(
      `${canal} a las 30 h: la bandeja dice atención humana y cuánto queda (~6 días)`,
      en.conv?.windowOpen === false &&
        h?.open === true &&
        h.remainingMs > 7 * DIA - 31 * HORA &&
        h.remainingMs <= 7 * DIA - 30 * HORA,
      JSON.stringify({ w: en.conv?.windowOpen, h })
    );
    const ia = await comoCerebro(en.conv.id, `respuesta automática ${MARCA}`);
    ok(
      `${canal} a las 30 h: la IA no puede → 409 window_closed que lo explica`,
      ia.res.status === 409 &&
        ia.json?.error?.code === "window_closed" &&
        ia.json?.error?.message?.includes("una persona"),
      `${ia.res.status} ${JSON.stringify(ia.json)}`
    );
    ok(`${canal} a las 30 h: y a la plataforma no salió nada`, (await enviadosPorZernio(en.hilo)).length === 0);
    const persona = await aMano(en.conv.id, `te contesto yo ${MARCA}`);
    ok(`${canal} a las 30 h: una persona sí → 200`, persona.res.ok, `${persona.res.status} ${JSON.stringify(persona.json)}`);
    const conEtiqueta = (await enviadosPorZernio(en.hilo)).at(-1);
    ok(
      `${canal} a las 30 h: sale con la etiqueta de agente humano`,
      conEtiqueta?.messagingType === "MESSAGE_TAG" && conEtiqueta?.messageTag === "HUMAN_AGENT",
      JSON.stringify(conEtiqueta)
    );
    const tras = (await conversaciones()).find((c) => c.id === en.conv.id);
    ok(
      `${canal}: contestar no alarga el plazo (cuenta el último mensaje del cliente)`,
      tras?.humanWindow?.open === true && tras.humanWindow.remainingMs <= h.remainingMs,
      JSON.stringify(tras?.humanWindow)
    );

    // Pasados 7 días: nadie.
    const fuera = await conversacion(red, "8d", 8 * DIA);
    ok(
      `${canal} a los 8 días: la bandeja la da por cerrada`,
      fuera.conv?.windowOpen === false && fuera.conv?.humanWindow?.open === false,
      JSON.stringify({ w: fuera.conv?.windowOpen, h: fuera.conv?.humanWindow })
    );
    const tarde = await aMano(fuera.conv.id, `ya es tarde ${MARCA}`);
    ok(
      `${canal} a los 8 días: ni una persona → 409 window_closed que dice 7 días`,
      tarde.res.status === 409 &&
        tarde.json?.error?.code === "window_closed" &&
        tarde.json?.error?.message?.includes("7 días"),
      `${tarde.res.status} ${JSON.stringify(tarde.json)}`
    );
    const tardeIa = await comoCerebro(fuera.conv.id, `ya es tarde ${MARCA}`);
    ok(`${canal} a los 8 días: ni la IA → 409`, tardeIa.res.status === 409, String(tardeIa.res.status));
    ok(`${canal} a los 8 días: a la plataforma no salió nada`, (await enviadosPorZernio(fuera.hilo)).length === 0);

    // El cliente vuelve a escribir: todo se abre otra vez.
    await entranteSocial(red, { sender: fuera.sender, nombre: fuera.nombre, text: `ya volví ${MARCA}` });
    const reabierta = await hasta(async () => {
      const c = (await conversaciones()).find((x) => x.id === fuera.conv.id);
      return c?.windowOpen ? c : null;
    });
    ok(`${canal}: si el cliente vuelve a escribir, la ventana se reabre`, Boolean(reabierta));
    const otraVez = await comoCerebro(fuera.conv.id, `bienvenido de vuelta ${MARCA}`);
    ok(`${canal}: y la IA puede contestar de nuevo`, otraVez.res.ok, `${otraVez.res.status} ${JSON.stringify(otraVez.json)}`);
  }

  console.log("\n== Los canales sin extensión no cambian ==");
  const tt = await conversacion("tt", "30h", 30 * HORA);
  ok(
    "TikTok no tiene atención humana: su ventana de 48 h sigue abierta a las 30",
    tt.conv?.humanWindow === null && tt.conv?.windowOpen === true,
    JSON.stringify({ w: tt.conv?.windowOpen, h: tt.conv?.humanWindow })
  );
  const ttIa = await comoCerebro(tt.conv.id, `hola desde la IA ${MARCA}`);
  ok("y ahí la IA sí contesta → 200", ttIa.res.ok, `${ttIa.res.status} ${JSON.stringify(ttIa.json)}`);
  const convWa = (await conversaciones()).find((c) => c.channel === "whatsapp");
  ok("WhatsApp tampoco la tiene", convWa?.humanWindow === null, JSON.stringify(convWa?.humanWindow));

  // 028 · D1 — El compositor solo ofrece lo que el canal puede mandar.
  console.log("\n== 028: lo que el compositor ofrece por canal ==");
  const todas = await conversaciones();
  ok(
    "WhatsApp: adjuntos, ubicación y contacto",
    convWa?.composer?.media === true && convWa?.composer?.structured === true,
    JSON.stringify(convWa?.composer)
  );
  for (const canal of ["instagram", "messenger", "tiktok"]) {
    const c = todas.find((x) => x.channel === canal);
    ok(
      `${canal}: la caja de texto sola`,
      c?.composer?.media === false && c?.composer?.structured === false,
      JSON.stringify(c?.composer)
    );
  }
}

// ---------------------------------------------------------------------------
// El agente (el cerebro, por el despacho) también sale plano
// ---------------------------------------------------------------------------

async function agenteContesta() {
  console.log("\n== El agente contesta plano en redes (cerebro por el despacho) ==");
  const cerebro = await levantarCerebroFalso({ base: BASE, botKey: BOT_KEY });
  try {
    const on = await encenderAgente(api);
    ok("agente encendido (contesta el cerebro falso)", on.res.ok, `${on.res.status} ${JSON.stringify(on.json)}`);
    await respuestaPlana(cerebro);
  } finally {
    await apagarAgente(api);
    await cerebro.esperar();
    await cerebro.apagar();
  }
}

async function respuestaPlana(cerebro) {
  const sender = `ig-agente-${RUN}`;
  const nombre = `Cliente ig agente ${MARCA}`;
  // El simulador de IA repite lo que dijo el cliente: si el cliente manda
  // asteriscos, lo que el cerebro piensa por /api/bot/llm los trae.
  const dicho = `quiero el *martillo* de **bola** ${MARCA}`;
  const e = await entranteSocial("ig", { sender, nombre, text: dicho });
  const conv = e.status === 200 ? await convDe(nombre) : null;
  const respuesta = await hasta(
    async () => (await mensajesDe(conv.id)).find((m) => m.direction === "out" && m.aiGenerated),
    COALESCE + 30000
  );
  ok("el agente contestó", Boolean(respuesta), "sin respuesta del agente");
  if (!respuesta) return;
  ok(
    "su respuesta repite al cliente pero sin las marcas",
    respuesta.text.includes(`quiero el martillo de bola ${MARCA}`) && !/\*/.test(respuesta.text),
    JSON.stringify(respuesta.text)
  );
  const salio = (await enviadosPorZernio(e.hilo)).at(-1);
  ok("y así llegó a Instagram", salio?.message === respuesta.text && !salio.messageTag, JSON.stringify(salio));
  const pedido = cerebro.respuestasDe(conv.id).find((r) => r.ruta === "/api/bot/messages");
  ok(
    "el cerebro la mandó con las marcas: el CRM es quien las quita",
    pedido?.status === 200 && /\*martillo\*/.test(pedido?.texto ?? ""),
    JSON.stringify(pedido?.texto)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
