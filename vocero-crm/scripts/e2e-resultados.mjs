/**
 * Self-test E2E de comportamiento — pantalla RESULTADOS (spec 019,
 * tests/e2e/us-resultados.md).
 *
 * Siembra por los caminos REALES —el webhook (wa-mock) con y sin `referral`,
 * la API del pipeline, el agente (036: el cerebro falso de
 * `scripts/lib/cerebro-falso.mjs` por el despacho, pensando por
 * `/api/bot/llm` contra el ai-mock), un envío que
 * Meta rechaza, una corrida del Laboratorio— y compara lo que devuelve cada
 * bloque de `/api/analytics/*` contra lo sembrado.
 *
 * La instancia puede traer datos de otros guiones: se compara la DIFERENCIA
 * entre una foto antes de sembrar y otra después, no los totales. Las filas
 * por anuncio sí son exactas, porque sus `source_id` son de esta corrida.
 *
 * La base se toca directo (como en e2e-bitacora-etapas) solo para lo que el
 * webhook no puede fabricar: mover fechas al pasado (un lead en silencio, una
 * ventana por cerrarse, un prospecto del periodo anterior) y, con la bandera
 * AGENDA, citas con cada desenlace.
 *
 * Uso (configuración estándar de la 036, ver `scripts/lib/cerebro-falso.mjs`):
 *   node --env-file=.env.e2e-036 scripts/e2e-resultados.mjs
 * Requiere: app viva con los mocks (WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL →
 * wa-mock, OPENROUTER_BASE_URL → ai-mock), BOT_API_KEY,
 * BRAIN_DISPATCH_URL=http://127.0.0.1:3261/vocero/dispatch y la BD migrada.
 * Corre con AGENDA apagada o encendida: lo lee del mismo entorno que la app.
 */
import postgres from "postgres";
import { apagarAgente, encenderAgente, levantarCerebroFalso } from "./lib/cerebro-falso.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const PN = "PN-RES-1";
const RUN = String(Date.now()).slice(-6);
const AGENDA = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());

let cookie = "";
let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      // Better Auth valida Origin (CSRF) en los endpoints de auth.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que algo OCURRA, en vez de dormir un rato y confiar. */
async function hasta(cond, ms = 30000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    try {
      if (await cond()) return true;
    } catch {
      /* reintenta */
    }
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const tel = (n) => `52157${RUN}${String(n).padStart(2, "0")}`;
const nombre = (n) => `Resultados ${RUN} ${n}`;
let origenMock = BASE;
try {
  origenMock = new URL(process.env.META_GRAPH_BASE_URL).origin;
} catch {
  /* sin META_GRAPH_BASE_URL: el propio BASE */
}
const referral = ({ id, titular, tipo = "ad", imagen = true }) => ({
  source_url: `https://fb.me/resultados-${RUN}-${id}`,
  source_id: `9019${RUN}${id}`,
  source_type: tipo,
  headline: titular,
  body: `Texto del anuncio ${id}`,
  media_type: "image",
  ...(imagen
    ? { image_url: `${origenMock}/api/dev/wa-mock/media-file/creativo-res-${RUN}-${id}` }
    : {}),
  ctwa_clid: `clid-019-${RUN}-${id}`,
});
const R1 = referral({ id: 1, titular: `Diagnóstico gratis ${RUN}` });
const R2 = referral({ id: 2, titular: `Segundo anuncio ${RUN}`, imagen: false });
const P1 = referral({ id: 3, titular: `Publicación ${RUN}`, tipo: "post", imagen: false });

const entra = (n, texto, ref) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: tel(n),
      name: nombre(n),
      text: texto,
      waMessageId: `wamid.e2e.019.${RUN}.${n}`,
      ...(ref ? { referral: ref } : {}),
    }),
  });

async function conversacionDe(n) {
  let hallada = null;
  await hasta(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    hallada = convs.find((c) => c.contact.name === nombre(n) && c.preview != null) ?? null;
    return !!hallada;
  });
  return hallada;
}

/** Las cuatro secciones, sobre el MISMO rango. */
async function foto(q) {
  const [sales, ads, bot, hygiene] = await Promise.all(
    ["sales", "ads", "bot", "hygiene"].map(async (b) =>
      (await api(`/api/analytics/${b}${b === "hygiene" ? "" : `?${q}`}`)).json
    )
  );
  return { sales, ads, bot, hygiene };
}

const fuente = (f, value) =>
  f.ads.sources.find((s) => s.value === value) ?? { conversations: 0, leads: 0, won: 0 };
const motivo = (f, reason) => f.sales.lossReasons.find((r) => r.reason === reason)?.count ?? 0;
const escalo = (f, key) => f.bot.handoffs.find((h) => h.key === key)?.count ?? 0;
const fallidos = (f, re) =>
  f.hygiene.failedMessages.filter((m) => re.test(m.error)).reduce((a, m) => a + m.count, 0);
const paso = (f, kind, i = 0) => f.sales.funnel.filter((s) => s.kind === kind)[i]?.reached ?? 0;
const anuncio = (f, r) => f.ads.ads.find((a) => a.sourceId === r.source_id);

async function main() {
  console.log(`== Setup (AGENDA ${AGENDA ? "encendida" : "apagada"}) ==`);
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
    body: JSON.stringify({ wabaId: "WABA-RES", phoneNumberId: PN, token: "tok-res" }),
  });
  ok("conexión WhatsApp guardada (vía wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  // El agente tiene que contestar: el cerebro falso, con el interruptor
  // encendido. Al final se apaga (y se cierra el cerebro).
  cerebro = await levantarCerebroFalso({ base: BASE, botKey: BOT_KEY });
  const encendido = await encenderAgente(api);
  ok("agente encendido para la corrida (contesta el cerebro falso)", encendido.res.ok, JSON.stringify(encendido.json));

  const board = (await api("/api/pipeline/board")).json;
  const abiertas = (board?.stages ?? [])
    .filter((s) => s.kind === "open")
    .sort((a, b) => a.position - b.position);
  const ganada = board?.stages?.find((s) => s.kind === "won");
  const perdida = board?.stages?.find((s) => s.kind === "lost");
  ok("el tablero tiene etapas abiertas, ganada y perdida", abiertas.length > 0 && !!ganada && !!perdida);

  // El rango de todas las fotos: el de por defecto (30 días hasta hoy, en la
  // zona del negocio), fijado para que antes y después midan lo mismo.
  const porDefecto = (await api("/api/analytics/sales")).json?.period;
  ok(
    "sin rango, Resultados mira los últimos 30 días en la zona del negocio",
    porDefecto?.days === 30 && !!porDefecto?.timezone,
    JSON.stringify(porDefecto)
  );
  const q = `from=${porDefecto?.from}&to=${porDefecto?.to}`;

  console.log("\n== 1 · Las cuatro secciones responden, y lo imposible se explica ==");
  for (const b of ["sales", "ads", "bot", "hygiene"]) {
    const r = await api(`/api/analytics/${b}${b === "hygiene" ? "" : `?${q}`}`);
    ok(`${b}: 200 con datos`, r.res.status === 200 && r.json !== null, `status=${r.res.status}`);
  }
  for (const [qs, que] of [
    ["from=2026-03-10&to=2026-03-01", "un rango invertido"],
    ["from=ayer", "una fecha inventada"],
    ["from=2026-02-31&to=2026-03-01", "una fecha que no existe"],
    ["from=2020-01-01&to=2026-01-01", "un rango de años"],
  ]) {
    const r = await api(`/api/analytics/sales?${qs}`);
    ok(
      `${que} responde 422 con mensaje, no 500`,
      r.res.status === 422 && !!r.json?.error?.message,
      `status=${r.res.status} ${JSON.stringify(r.json)}`
    );
  }

  const antes = await foto(q);

  console.log("\n== 2 · Siembra por el webhook, el pipeline y el agente ==");
  // 1-3: anuncio R1 (con creativo) · 4: anuncio R2 · 5: una PUBLICACIÓN ·
  // 6: pide un humano · 7-8: orgánicos · 9: alta manual como «referido» que
  // luego escribe · 10: orgánico que se lleva al periodo anterior.
  const siembra = [
    [1, "Hola, vi su anuncio del diagnóstico", R1],
    [2, "Hola, vi su anuncio, ¿cuánto cuesta?", R1],
    [3, "Buenas tardes, vi lo del anuncio", R1],
    [4, "Hola, vengo del otro anuncio", R2],
    [5, "Hola, vi su publicación", P1],
    [6, "quiero hablar con un humano", null],
    // Sin "horario", "cita" ni "reserva": el ai-mock los contesta ofreciendo
    // huecos, y sin AGENDA eso es un error del proveedor (y un escalamiento).
    [7, "Hola, ¿tienen servicio a domicilio?", null],
    [8, "Hola, ¿hacen envíos a Puebla?", null],
  ];
  const alta = await api("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: nombre(9), phone: tel(9), source: "referido" }),
  });
  ok("alta manual con fuente «referido»", alta.res.ok, JSON.stringify(alta.json));
  siembra.push([9, "Hola, me recomendó una amiga", null], [10, "Hola, buen día", null]);

  for (const [n, texto, ref] of siembra) {
    const r = await entra(n, texto, ref);
    if (!r.res.ok) ok(`el webhook acepta el mensaje ${n}`, false, `status=${r.res.status}`);
  }
  const conv = {};
  for (const [n] of siembra) conv[n] = await conversacionDe(n);
  ok(
    "las diez conversaciones existen",
    siembra.every(([n]) => !!conv[n]),
    siembra.filter(([n]) => !conv[n]).map(([n]) => n).join(",")
  );

  // El cerebro contesta a todos menos al que pidió un humano: a ése le
  // avisa que lo comunica con una persona y lo traspasa (como Nea).
  const contestadas = await hasta(async () => {
    for (const [n] of siembra) {
      if (n === 6) continue;
      const msgs = (await api(`/api/conversations/${conv[n]?.id}/messages`)).json?.messages ?? [];
      if (!msgs.some((m) => m.direction === "out" && m.origin === "ai")) return false;
    }
    return true;
  }, 60000, 1000);
  ok("el agente contestó las nueve conversaciones que no pidieron humano", contestadas);
  const escalada = await hasta(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    return convs.find((c) => c.id === conv[6]?.id)?.handoffReason === "cliente";
  });
  ok("la que pidió un humano quedó escalada por el cliente", escalada);
  let aviso = [];
  await hasta(async () => {
    aviso = ((await api(`/api/conversations/${conv[6]?.id}/messages`)).json?.messages ?? [])
      .filter((m) => m.direction === "out" && m.origin === "ai");
    return aviso.length > 0;
  });
  ok(
    "y recibió el aviso del traspaso, no silencio",
    aviso.length === 1 && /persona del equipo/.test(aviso[0]?.text ?? ""),
    JSON.stringify(aviso.map((m) => m.text))
  );

  // El creativo de R1 se copia en segundo plano: la fila por anuncio lo trae
  // cuando la copia terminó.
  const conImagen = await hasta(async () => {
    const d = (await api(`/api/contacts/${conv[1]?.contact.id}`)).json;
    return !!d?.anuncio?.imageAssetId;
  });
  ok("el creativo del anuncio R1 quedó copiado", conImagen);

  // Movimientos por la API del pipeline (la misma puerta que el tablero).
  const leads = (await api("/api/pipeline/board")).json?.leads ?? [];
  const leadDe = (n) => leads.find((l) => l.contact.id === conv[n]?.contact.id);
  const mover = async (n, body) => {
    const r = await api(`/api/pipeline/leads/${leadDe(n)?.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!r.res.ok) ok(`mover el lead ${n}`, false, `status=${r.res.status} ${JSON.stringify(r.json)}`);
    // Dos movimientos del mismo lead en el mismo milisegundo no se ordenan.
    await sleep(30);
    return r;
  };
  await mover(1, { amountCents: 12_000_00, currency: "MXN" });
  await mover(1, { stageId: ganada.id });
  await mover(2, { stageId: perdida.id, lossReason: "precio" });
  // Ganado, sacado y vuelto a ganar: UN trato, su monto una vez.
  await mover(4, { amountCents: 5_000_00, currency: "MXN" });
  await mover(4, { stageId: ganada.id });
  await mover(4, { stageId: abiertas[0].id });
  await mover(4, { stageId: ganada.id });
  // Ganado y devuelto al embudo: no es venta.
  await mover(7, { stageId: ganada.id });
  await mover(7, { stageId: abiertas.at(-1).id });
  await mover(8, { amountCents: 3_000_00, currency: "MXN" });

  // Un envío que Meta rechaza (mismo camino que e2e-send-failure).
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const envio = await api(`/api/conversations/${conv[7]?.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ text: `mensaje que Meta rechaza ${RUN}` }),
  });
  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  const wamid = outbox.find((m) => JSON.stringify(m).includes(`Meta rechaza ${RUN}`))?.waMessageId
    ?? outbox.at(-1)?.waMessageId;
  const estado = await api("/api/dev/wa-mock/status", {
    method: "POST",
    body: JSON.stringify({
      waMessageId: wamid,
      status: "failed",
      errorCode: 130472,
      errorMessage: "User's number is part of an experiment",
    }),
  });
  ok("envío rechazado por Meta (status failed)", envio.res.ok && estado.res.ok, `wamid=${wamid}`);
  await hasta(async () => {
    const msgs = (await api(`/api/conversations/${conv[7]?.id}/messages`)).json?.messages ?? [];
    return msgs.some((m) => m.status === "failed");
  });

  // Una ficha, para que la cobertura sea medible.
  if (BOT_KEY) {
    await api("/api/bot/ficha", {
      method: "PUT",
      headers: { "x-api-key": BOT_KEY },
      body: JSON.stringify({ conversationId: conv[1]?.id, ficha: { interes: "diagnóstico" } }),
    });
  }

  // Lo que el webhook no puede fabricar: fechas en el pasado.
  const ct = (n) => conv[n]?.contact.id;
  // 8 · en silencio: el cliente no escribe desde hace ocho días.
  await sql`update conversation set last_inbound_at = now() at time zone 'utc' - interval '8 days'
            where contact_id = ${ct(8)} and is_test = false`;
  // 5 · ventana por cerrarse: escribió hace 21 h y nadie le contestó después.
  await sql`update conversation set last_inbound_at = now() at time zone 'utc' - interval '21 hours',
            last_message_at = now() at time zone 'utc' - interval '21 hours'
            where contact_id = ${ct(5)} and is_test = false`;
  // 10 · entró en el periodo ANTERIOR.
  await sql`update lead set created_at = created_at - interval '32 days' where contact_id = ${ct(10)}`;
  await sql`update lead_stage_event set occurred_at = occurred_at - interval '32 days' where contact_id = ${ct(10)}`;
  await sql`update conversation set created_at = created_at - interval '32 days' where contact_id = ${ct(10)} and is_test = false`;
  await sql`update contact set created_at = created_at - interval '32 days' where id = ${ct(10)}`;

  // Con agenda: una cita de cada desenlace + una de prueba que no cuenta.
  if (AGENDA) {
    const org = (await sql`select organization_id from contact where id = ${ct(1)}`)[0]?.organization_id;
    const citas = [
      ["realizada", 1, false],
      ["no_show", 2, false],
      ["cancelada", 3, false],
      ["agendada", 4, false],
      ["realizada", 5, true],
    ];
    // Minutos propios de esta corrida: el índice anti doble-booking no deja dos
    // citas activas en el mismo instante, y otra corrida pudo usar esa hora.
    const minutos = Number(RUN) % 50;
    for (const [status, horas, isTest] of citas) {
      await sql`insert into booking (id, organization_id, kind, status, source, contact_id, scheduled_at, duration_minutes, is_test)
        values (${`bk_res_${RUN}_${horas}`}, ${org}, 'session', ${status}, 'manual', ${ct(1)},
                date_trunc('hour', now() at time zone 'utc')
                  - make_interval(hours => ${horas}::int, mins => ${minutos}::int),
                30, ${isTest})`;
    }
  }

  const despues = await foto(q);

  console.log("\n== 3 · Ventas y embudo ==");
  const d = (f) => f(despues) - f(antes);
  ok("prospectos nuevos: +9 en el periodo", d((f) => f.sales.kpis.newLeads.current) === 9,
    `Δ=${d((f) => f.sales.kpis.newLeads.current)}`);
  ok("y +1 en el periodo anterior", d((f) => f.sales.kpis.newLeads.previous) === 1,
    `Δ=${d((f) => f.sales.kpis.newLeads.previous)}`);
  ok("tratos ganados: +2 (el devuelto al embudo no cuenta; el ganado dos veces, una)",
    d((f) => f.sales.kpis.won.current) === 2, `Δ=${d((f) => f.sales.kpis.won.current)}`);
  ok("tratos perdidos: +1", d((f) => f.sales.kpis.lost.current) === 1,
    `Δ=${d((f) => f.sales.kpis.lost.current)}`);
  ok("dinero ganado: +$17,000.00, cada monto una vez", d((f) => f.sales.kpis.wonCents.current) === 17_000_00,
    `Δ=${d((f) => f.sales.kpis.wonCents.current)}`);
  ok("la tasa de cierre viaja con su denominador (+3 cerrados)",
    d((f) => f.sales.kpis.winRate.sample) === 3, JSON.stringify(despues.sales.kpis.winRate));
  ok("motivo de pérdida «precio»: +1", d((f) => motivo(f, "precio")) === 1);
  ok("embudo: los 9 del periodo están en la primera etapa", d((f) => paso(f, "open")) === 9,
    `Δ=${d((f) => paso(f, "open"))}`);
  ok("embudo: 3 llegaron a Ganado (también el que se devolvió)", d((f) => paso(f, "won")) === 3,
    `Δ=${d((f) => paso(f, "won"))}`);
  ok("hoy en el embudo: +$3,000.00 abiertos", d((f) => f.sales.pipeline.openCents) === 3_000_00,
    `Δ=${d((f) => f.sales.pipeline.openCents)}`);
  ok("hoy en el embudo: +6 tratos abiertos sin monto", d((f) => f.sales.pipeline.withoutAmount) === 6,
    `Δ=${d((f) => f.sales.pipeline.withoutAmount)}`);
  const serie = despues.sales.series;
  ok("la serie trae cada día del periodo, con cero donde no pasó nada",
    serie.length === porDefecto.days && serie[0]?.bucket === porDefecto.from && serie.at(-1)?.bucket === porDefecto.to,
    `${serie.length} cubetas`);
  ok("y cuadra con los indicadores",
    serie.reduce((a, s) => a + s.won, 0) === despues.sales.kpis.won.current &&
      serie.reduce((a, s) => a + s.newLeads, 0) === despues.sales.kpis.newLeads.current);

  console.log("\n== 4 · Origen y anuncios (solo conteos) ==");
  ok("conversaciones nuevas: +9, y +1 en el periodo anterior",
    d((f) => f.ads.conversations.current) === 9 && d((f) => f.ads.conversations.previous) === 1,
    `Δ=${d((f) => f.ads.conversations.current)}/${d((f) => f.ads.conversations.previous)}`);
  const an = (f) => fuente(f, "anuncio");
  ok("origen «Anuncio»: +4 conversaciones, +4 prospectos, +2 ventas",
    d((f) => an(f).conversations) === 4 && d((f) => an(f).leads) === 4 && d((f) => an(f).won) === 2,
    JSON.stringify(an(despues)));
  const sinId = (f) => fuente(f, "desconocida");
  ok("la publicación NO cuenta como anuncio: «Sin identificar» +4 / +4 / +0",
    d((f) => sinId(f).conversations) === 4 && d((f) => sinId(f).leads) === 4 && d((f) => sinId(f).won) === 0,
    JSON.stringify(sinId(despues)));
  const ref = (f) => fuente(f, "referido");
  ok("lo capturado manda: «Referido» +1 conversación, +1 prospecto",
    d((f) => ref(f).conversations) === 1 && d((f) => ref(f).leads) === 1, JSON.stringify(ref(despues)));
  ok("«llegaron por un anuncio» cuenta 4 de 9 conversaciones nuevas",
    d((f) => f.ads.adShare.sample) === 9, JSON.stringify(despues.ads.adShare));
  // Por las LLAVES, no por el texto: un id aleatorio puede contener "cac".
  const llaves = (o) =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => [k, ...llaves(v)])
      : [];
  ok("ninguna fila trae gasto, costo ni retorno",
    !llaves(despues.ads).some((k) => /spend|cost|roas|cac|gasto/i.test(k)),
    llaves(despues.ads).filter((k) => /spend|cost|roas|cac|gasto/i.test(k)).join(","));

  const a1 = anuncio(despues, R1);
  ok("anuncio R1: 3 conversaciones, 3 prospectos, 1 venta, 33 % de 3",
    a1?.conversations === 3 && a1?.leads === 3 && a1?.won === 1 &&
      a1?.winRate?.value === 33 && a1?.winRate?.sample === 3 && a1?.winRate?.reliable === false,
    JSON.stringify(a1));
  ok("anuncio R1 trae titular, tipo e imagen", a1?.headline === R1.headline && a1?.sourceType === "ad" && !!a1?.imageAssetId,
    JSON.stringify(a1));
  if (a1?.imageAssetId) {
    const img = await fetch(`${BASE}/api/media/${a1.imageAssetId}`, { headers: { cookie } });
    ok("la miniatura se sirve desde /api/media", img.ok && /^image\//.test(img.headers.get("content-type") ?? ""),
      `status=${img.status} ${img.headers.get("content-type")}`);
  }
  const a2 = anuncio(despues, R2);
  ok("anuncio R2: 1 / 1 / 1 y sin imagen", a2?.conversations === 1 && a2?.leads === 1 && a2?.won === 1 && a2?.imageAssetId === null,
    JSON.stringify(a2));
  const p1 = anuncio(despues, P1);
  ok("la publicación tiene su fila, marcada como post", p1?.sourceType === "post" && p1?.conversations === 1 && p1?.won === 0,
    JSON.stringify(p1));
  ok("el ctwa_clid no sale por la API", !JSON.stringify(despues.ads).includes("clid-019"));

  console.log("\n== 5 · El agente ==");
  ok("conversaciones nuevas: +9", d((f) => f.bot.conversations) === 9, `Δ=${d((f) => f.bot.conversations)}`);
  ok("«contestó el agente» se mide sobre las 9 con mensaje del cliente",
    d((f) => f.bot.aiReplyRate.sample) === 9, JSON.stringify(despues.bot.aiReplyRate));
  // El aviso del traspaso es un saliente con origen IA: la escalada también
  // tuvo respuesta del agente, y a los segundos.
  ok("primera respuesta: +9 medidas (también la escalada: su aviso del traspaso)",
    d((f) => f.bot.firstResponseSample) === 9 && despues.bot.firstResponseSeconds !== null,
    `Δ=${d((f) => f.bot.firstResponseSample)} mediana=${despues.bot.firstResponseSeconds}`);
  ok("pasó a un humano: +1 «El cliente pidió un humano»", d((f) => escalo(f, "cliente")) === 1,
    JSON.stringify(despues.bot.handoffs));
  ok("la tasa de escalamiento es sobre las conversaciones del periodo",
    d((f) => f.bot.handoffRate.sample) === 9, JSON.stringify(despues.bot.handoffRate));
  if (BOT_KEY) {
    ok("la ficha se mide sobre los contactos nuevos del periodo (+9)",
      despues.bot.fichaCoverage !== null && d((f) => f.bot.fichaCoverage?.sample ?? 0) === 9,
      JSON.stringify(despues.bot.fichaCoverage));
  }
  if (AGENDA) {
    const s = (f) => f.bot.sessions;
    ok("citas: +4 agendadas (la de prueba no cuenta)", d((f) => s(f).booked) === 4, JSON.stringify(s(despues)));
    ok("citas: +1 realizada, +1 no llegó, +1 cancelada",
      d((f) => s(f).done) === 1 && d((f) => s(f).noShow) === 1 && d((f) => s(f).cancelled) === 1,
      JSON.stringify(s(despues)));
    ok("asistencia contra las que tuvieron desenlace (+2)", d((f) => s(f).showRate.sample) === 2,
      JSON.stringify(s(despues).showRate));
  } else {
    ok("sin AGENDA, la API no trae citas (sessions: null)", despues.bot.sessions === null,
      JSON.stringify(despues.bot.sessions));
  }

  console.log("\n== 6 · Qué se está cayendo ==");
  ok("en silencio: +1, con su dinero ($3,000.00)",
    d((f) => f.hygiene.silentCount) === 1 && d((f) => f.hygiene.silentAmountCents) === 3_000_00,
    `Δ=${d((f) => f.hygiene.silentCount)} / ${d((f) => f.hygiene.silentAmountCents)}`);
  ok("el silencioso lleva a su conversación y dice 8 días",
    despues.hygiene.silent.some((l) => l.contactId === ct(8) && l.days === 8),
    JSON.stringify(despues.hygiene.silent.find((l) => l.contactId === ct(8))));
  ok("mensajes que no llegaron: +1 con el código de Meta", d((f) => fallidos(f, /130472/)) === 1,
    JSON.stringify(despues.hygiene.failedMessages));
  const ventana = despues.hygiene.closingWindows.find((c) => c.contactId === ct(5));
  ok("la ventana por cerrarse aparece con ~3 h", !!ventana && ventana.hoursLeft > 2.5 && ventana.hoursLeft <= 3,
    JSON.stringify(ventana));

  console.log("\n== 7 · El Laboratorio no existe para Resultados ==");
  // Un lead para un contacto cuya ÚNICA conversación es de prueba (el
  // Laboratorio no los crea, pero si un camino lo hiciera no debe contar).
  let corrida = await api("/api/lab/runs", { method: "POST" });
  if (corrida.res.status === 409 && corrida.json?.error?.code === "run_in_progress") {
    await sleep(15000);
    corrida = await api("/api/lab/runs", { method: "POST" });
  }
  ok("corrida del Laboratorio lanzada", corrida.res.status === 202, JSON.stringify(corrida.json));
  const termino = await hasta(async () => {
    const r = (await api(`/api/lab/runs/${corrida.json?.runId}`)).json?.run;
    return r && r.status !== "running";
  }, 240000, 2000);
  ok("la corrida terminó", termino);
  const labContacto = (await sql`
    select c.id, c.organization_id from contact c
    where exists (select 1 from conversation v where v.contact_id = c.id and v.is_test = true)
      and not exists (select 1 from conversation v where v.contact_id = c.id and v.is_test = false)
      and not exists (select 1 from lead l where l.contact_id = c.id)
    limit 1`)[0];
  const etapa = (await sql`select id from pipeline_stage where organization_id = ${labContacto?.organization_id ?? ""} and kind = 'open' order by position limit 1`)[0];
  if (labContacto && etapa) {
    await sql`insert into lead (id, organization_id, contact_id, stage_id) values (${`ld_lab_${RUN}`}, ${labContacto.organization_id}, ${labContacto.id}, ${etapa.id})`;
  }
  ok("hay un contacto del Laboratorio para la prueba", !!labContacto);
  const conLab = await foto(q);
  if (labContacto) await sql`delete from lead where id = ${`ld_lab_${RUN}`}`;
  const igual = (f) => JSON.stringify(f(conLab)) === JSON.stringify(f(despues));
  ok("ventas: ni el lead del Laboratorio ni su corrida mueven un número",
    igual((f) => [f.sales.kpis.newLeads, f.sales.kpis.won, f.sales.pipeline, f.sales.funnel.map((s) => s.reached)]),
    JSON.stringify(conLab.sales.kpis.newLeads));
  ok("el agente: las conversaciones y escalamientos de prueba no cuentan",
    igual((f) => [f.bot.conversations, f.bot.aiReplyRate, f.bot.firstResponseSample, f.bot.handoffs, f.bot.fichaCoverage]),
    JSON.stringify([conLab.bot.conversations, conLab.bot.handoffs]));
  ok("origen y anuncios: sin cambios", igual((f) => [f.ads.conversations, f.ads.sources]));
  ok("higiene: sin cambios", igual((f) => [f.hygiene.silentCount, f.hygiene.failedMessages.map((m) => m.count)]));

  console.log("\n== 8 · La pantalla y la sesión ==");
  const pagina = await fetch(`${BASE}/results`, { headers: { cookie } });
  const html = await pagina.text();
  ok("/results carga con sesión", pagina.status === 200 && html.includes("Resultados"), `status=${pagina.status}`);
  ok("y el menú lleva a Resultados", html.includes('href="/results"'));
  for (const b of ["sales", "ads", "bot", "hygiene"]) {
    const r = await fetch(`${BASE}/api/analytics/${b}`);
    ok(`sin sesión, /api/analytics/${b} responde 401`, r.status === 401, `status=${r.status}`);
  }

  await cerrarCerebro();
  await sql.end();
  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

let cerebro = null;
async function cerrarCerebro() {
  if (cookie) await apagarAgente(api).catch(() => {});
  await cerebro?.esperar().catch(() => {});
  await cerebro?.apagar().catch(() => {});
}

main().catch(async (err) => {
  console.error(`\nError conduciendo el guion: ${err.stack ?? err.message}`);
  await cerrarCerebro();
  await sql.end().catch(() => {});
  process.exit(1);
});
