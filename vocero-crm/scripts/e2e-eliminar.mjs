/**
 * Self-test E2E de comportamiento — 026: eliminar una conversación.
 *
 * Conduce la app real con los simuladores de canal y hace de CEREBRO con el
 * cerebro falso compartido (`scripts/lib/cerebro-falso.mjs`): un servidor HTTP
 * en `BRAIN_DISPATCH_URL`, en este proceso, que recibe los turnos y el aviso
 * `conversation.deleted` y verifica su firma sobre el cuerpo crudo, como debe
 * hacerlo un cerebro de verdad. Aquí no contesta (`responder: "ninguna"`):
 * se prueba el borrado, no quién responde. 036: para que haya turnos, el
 * interruptor del Agente se enciende (con el cerebro sano) y se apaga al final.
 *
 * Uso (configuración estándar de la 036, ver `scripts/lib/cerebro-falso.mjs`):
 *   1) app corriendo (`pnpm dev`) sobre una base migrada, con
 *      WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock, BOT_API_KEY y
 *      BRAIN_DISPATCH_URL=http://127.0.0.1:3261/vocero/dispatch.
 *      Con AGENDA=on corre además la cita por venir (AC6).
 *   2) node --env-file=.env.e2e-036 scripts/e2e-eliminar.mjs
 *
 * Dos modos, según cómo arrancó la app:
 *   - con BRAIN_DISPATCH_URL: todo, incluido el aviso al cerebro;
 *   - sin ella: el borrado y `agente: "no_aplica"` (no hay a quién avisar).
 * El gate completo son las dos corridas.
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-eliminar.md.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { apagarAgente, encenderAgente, levantarCerebroFalso } from "./lib/cerebro-falso.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const DISPATCH = (process.env.BRAIN_DISPATCH_URL ?? "").trim();
const MEDIA_DIR = process.env.MEDIA_DIR ?? "";
const AGENDA = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const MARCA = `#${RUN}`;
const DIGITOS = String(Date.now() % 1_000_000).padStart(6, "0");
const telefono = (n) => `52155${DIGITOS}${String(n).padStart(2, "0")}`;
const CLAVES_DEL_OLVIDO = ["type", "eventId", "organization", "conversation", "contact", "deletedAt"];

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

/** `jar` aparte para actuar como otra persona sin perder la sesión del dueño. */
async function api(ruta, opts = {}, jar = null) {
  const actual = jar ? jar.cookie : cookie;
  const res = await fetch(`${BASE}${ruta}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(actual ? { cookie: actual } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const nueva = setCookie.map((c) => c.split(";")[0]).join("; ");
    if (jar) jar.cookie = nueva;
    else cookie = nueva;
  }
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(cond, ms = 15000, paso = 250) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > fin) return null;
    await sleep(paso);
  }
}

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------

let nMensaje = 0;
const entranteWa = (from, name, text, extra = {}) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.eliminar.${RUN}.${++nMensaje}`,
      ...extra,
    }),
  });

const conversaciones = async () => (await api("/api/conversations")).json?.conversations ?? [];
const convDe = (name) =>
  hasta(async () => (await conversaciones()).find((c) => c.contact.name === name && c.lastInboundAt));
const mensajes = (id) => api(`/api/conversations/${id}/messages`);
const contacto = (id) => api(`/api/contacts/${id}`);
const eliminar = (id, { contacto: tambien = false } = {}, jar = null) =>
  api(`/api/conversations/${id}${tambien ? "?contacto=1" : ""}`, { method: "DELETE" }, jar);

/** Una persona nueva escribe; devuelve su conversación ya ingerida. */
async function persona(n, etiqueta) {
  const tel = telefono(n);
  const nombre = `Borrar ${etiqueta} ${MARCA}`;
  await entranteWa(tel, nombre, `hola, soy ${etiqueta} ${MARCA}`);
  return { tel, nombre, conv: await convDe(nombre) };
}

/** ¿Hay en el volumen un archivo con ese id de adjunto, en cualquier organización? */
function archivoEnDisco(assetId) {
  if (!MEDIA_DIR || !existsSync(MEDIA_DIR)) return null;
  return readdirSync(MEDIA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .some((d) => existsSync(path.join(MEDIA_DIR, d.name, assetId)));
}

/** Escucha el SSE de la bandeja con la sesión actual hasta que `cuando` diga basta. */
function escucharEventos() {
  const controller = new AbortController();
  const vistos = [];
  const listo = (async () => {
    const res = await fetch(`${BASE}/api/events`, {
      headers: { cookie, accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const bloque = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const tipo = bloque.match(/^event: (.+)$/m)?.[1];
        const data = bloque.match(/^data: (.+)$/m)?.[1];
        if (tipo && data) {
          try {
            vistos.push({ type: tipo, data: JSON.parse(data) });
          } catch {}
        }
      }
    }
  })().catch(() => {});
  return { vistos, cerrar: () => (controller.abort(), listo) };
}

// ---------------------------------------------------------------------------

async function main() {
  const conCerebro = Boolean(DISPATCH);
  if (conCerebro && !BOT_KEY) {
    console.error("Con BRAIN_DISPATCH_URL hace falta BOT_API_KEY: con ella se firma el aviso.");
    process.exit(1);
  }
  console.log(`== Setup (${conCerebro ? "con cerebro por despacho" : "sin despacho"}${AGENDA ? ", agenda encendida" : ""}) ==`);
  const cerebro = conCerebro
    ? await levantarCerebroFalso({ base: BASE, botKey: BOT_KEY, url: new URL(DISPATCH), responder: "ninguna" })
    : null;

  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  ok("registro o login del propietario", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }),
  });
  ok("conexión de WhatsApp guardada (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  // 036: con despacho, el interruptor encendido (con el cerebro sano) para que
  // haya turnos; el cerebro no contesta. Sin despacho, apagado.
  if (cerebro) {
    const on = await encenderAgente(api);
    ok("(con despacho) interruptor del Agente encendido", on.res.ok, `${on.res.status} ${JSON.stringify(on.json)}`);
  } else {
    await apagarAgente(api);
  }

  try {
    await permisos();
    await elHilo(cerebro);
    await elContacto(cerebro);
    if (cerebro) await cerebroCaido(cerebro);
    await citaPorVenir();
  } finally {
    await apagarAgente(api).catch(() => {});
    if (cerebro) await cerebro.apagar().catch(() => {});
  }

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// AC5 — Quién puede
// ---------------------------------------------------------------------------

async function permisos() {
  console.log("\n== AC5: solo quien administra, y solo lo que existe ==");
  const p = await persona(1, "permisos");
  ok("hay una conversación que cuidar", Boolean(p.conv));

  const correo = `equipo-${RUN}@vocero.test`;
  const clave = "password-equipo-123";
  const alta = await api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "Equipo E2E", email: correo, password: clave }),
  });
  const jar = { cookie: "" };
  const entra = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: correo, password: clave }) }, jar);
  ok("una persona del equipo inicia sesión", alta.res.status === 201 && entra.res.ok, `${alta.res.status} ${entra.res.status}`);

  const deMiembro = await eliminar(p.conv.id, {}, jar);
  ok("un miembro del equipo → 403", deMiembro.res.status === 403 && deMiembro.json?.error?.code === "forbidden", `${deMiembro.res.status} ${JSON.stringify(deMiembro.json)}`);
  const conTodo = await eliminar(p.conv.id, { contacto: true }, jar);
  ok("tampoco con el contacto → 403", conTodo.res.status === 403, String(conTodo.res.status));
  const noExiste = await eliminar("cv_no_existe_0000000000");
  ok("una conversación que no existe → 404", noExiste.res.status === 404, String(noExiste.res.status));
  ok(
    "y la conversación sigue en la bandeja, con su mensaje",
    (await conversaciones()).some((c) => c.id === p.conv.id) &&
      ((await mensajes(p.conv.id)).json?.messages ?? []).length === 1
  );
}

// ---------------------------------------------------------------------------
// AC1, AC2, AC3, AC7, AC9, AC10 — El hilo
// ---------------------------------------------------------------------------

async function elHilo(cerebro) {
  console.log("\n== AC1–AC3: eliminar el hilo ==");
  const p = await persona(2, "hilo");
  // Un adjunto, para comprobar que se va de verdad.
  await entranteWa(p.tel, p.nombre, undefined, { type: "image", mediaId: "media123", mimeType: "image/jpeg", caption: `foto ${MARCA}` });
  const conFoto = await hasta(async () => {
    const ms = (await mensajes(p.conv.id)).json?.messages ?? [];
    return ms.find((m) => m.media?.assetId) ?? null;
  });
  ok("la conversación tiene un adjunto", Boolean(conFoto), "no llegó el mensaje con imagen");
  const assetId = conFoto?.media?.assetId;
  const antes = assetId ? await fetch(`${BASE}/api/media/${assetId}`, { headers: { cookie } }) : null;
  ok("el adjunto se puede abrir antes de borrar", antes?.status === 200, String(antes?.status));
  const enDiscoAntes = assetId ? archivoEnDisco(assetId) : null;
  if (enDiscoAntes !== null) ok("y su archivo está en el volumen", enDiscoAntes === true);

  const contactId = p.conv.contact.id;
  await api(`/api/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: `nota que se queda ${MARCA}`, ficha: { interes: "taladro", presupuesto: 1500 } }),
  });
  const cAntes = (await contacto(contactId)).json;
  ok(
    "el contacto tiene notas, ficha y etapa",
    cAntes?.contact?.notes?.includes(MARCA) && cAntes?.contact?.ficha?.interes === "taladro" && Boolean(cAntes?.stage?.id),
    JSON.stringify({ n: cAntes?.contact?.notes, f: cAntes?.contact?.ficha, s: cAntes?.stage })
  );
  if (cerebro) {
    ok("(con despacho) el cerebro ya recibió turnos de esta conversación", Boolean(await hasta(() => cerebro.turnos(p.conv.id).length > 0)));
  }

  const sse = escucharEventos();
  await sleep(600);
  const r = await eliminar(p.conv.id);
  ok(
    `DELETE → 200 con alcance «hilo» y agente «${cerebro ? "avisado" : "no_aplica"}»`,
    r.res.status === 200 && r.json?.ok === true && r.json?.alcance === "hilo" && r.json?.agente === (cerebro ? "avisado" : "no_aplica"),
    `${r.res.status} ${JSON.stringify(r.json)}`
  );
  ok("ya no sale en la bandeja", !(await conversaciones()).some((c) => c.id === p.conv.id));
  const ms = await mensajes(p.conv.id);
  ok("sus mensajes ya no existen", ms.res.status === 404 || (ms.json?.messages ?? []).length === 0, `${ms.res.status} ${JSON.stringify(ms.json).slice(0, 120)}`);

  console.log("\n== AC2: el contacto se queda ==");
  const cDespues = (await contacto(contactId)).json;
  ok("el contacto sigue en Contactos, con su nota", cDespues?.contact?.notes?.includes(MARCA) === true, JSON.stringify(cDespues?.contact?.notes));
  ok("en la misma etapa del pipeline", cDespues?.stage?.id === cAntes?.stage?.id && cDespues?.lead?.id === cAntes?.lead?.id, JSON.stringify(cDespues?.stage));
  ok("y con la ficha vacía", JSON.stringify(cDespues?.contact?.ficha ?? null) === "{}", JSON.stringify(cDespues?.contact?.ficha));

  console.log("\n== AC3: el adjunto se fue de verdad ==");
  const despues = assetId ? await fetch(`${BASE}/api/media/${assetId}`, { headers: { cookie } }) : null;
  ok("el adjunto responde 404", despues?.status === 404, String(despues?.status));
  if (enDiscoAntes !== null) ok("y su archivo ya no está en el volumen", archivoEnDisco(assetId) === false);

  console.log("\n== AC10: la bandeja se entera sola ==");
  const aviso = await hasta(() => sse.vistos.find((e) => e.type === "conversation.deleted" && e.data?.conversationId === p.conv.id), 5000);
  await sse.cerrar();
  ok(
    "llega conversation.deleted por el SSE, sin contenido",
    aviso?.data?.contactId === contactId && aviso?.data?.contactDeleted === false && Object.keys(aviso.data).length === 3,
    JSON.stringify(aviso)
  );

  if (cerebro) {
    console.log("\n== AC7: el cerebro recibe el aviso ==");
    const olvidos = cerebro.olvidos(p.conv.id);
    const o = olvidos[0];
    ok("llegó exactamente un conversation.deleted", olvidos.length === 1, `llegaron ${olvidos.length}`);
    ok("firmado como un turno, sobre el cuerpo crudo", o?.firmaOk === true);
    ok(
      "con x-vocero-event, con la organización y SIN id de despacho",
      o?.cabeceras.evento === "conversation.deleted" && Boolean(o?.cabeceras.org) && o?.cabeceras.dispatch === null,
      JSON.stringify(o?.cabeceras)
    );
    ok("las claves, en el orden del contrato", JSON.stringify(Object.keys(o?.evento ?? {})) === JSON.stringify(CLAVES_DEL_OLVIDO), JSON.stringify(Object.keys(o?.evento ?? {})));
    const e = o?.evento ?? {};
    ok(
      "dice qué conversación, por qué canal y de quién",
      e.conversation?.id === p.conv.id && e.conversation?.channel === "whatsapp" && e.contact?.id === contactId && String(e.contact?.identity ?? "").endsWith(p.tel.slice(-10)),
      JSON.stringify({ c: e.conversation, ct: e.contact })
    );
    ok(
      "con un id de evento propio y la hora del borrado",
      /^olv_[0-9a-z]{20}$/.test(e.eventId ?? "") && Math.abs(Date.now() - Date.parse(e.deletedAt)) < 60_000,
      JSON.stringify({ id: e.eventId, at: e.deletedAt })
    );
    ok("y no lleva nada de lo borrado", !o?.crudo.includes(MARCA) && !o?.crudo.includes("taladro"), "");
  }

  const otra = await eliminar(p.conv.id);
  ok("eliminarla otra vez → 404", otra.res.status === 404, String(otra.res.status));

  console.log("\n== AC9: si vuelve a escribir, es una conversación nueva ==");
  await entranteWa(p.tel, p.nombre, `ya volví ${MARCA}`);
  const nueva = await hasta(async () => (await conversaciones()).find((c) => c.contact.id === contactId && c.lastInboundAt));
  ok("del mismo contacto, con otro id", Boolean(nueva) && nueva.id !== p.conv.id, JSON.stringify(nueva?.id));
  ok("y sin historial: solo el mensaje nuevo", ((await mensajes(nueva.id)).json?.messages ?? []).length === 1);
  if (cerebro) {
    const turno = await hasta(() => cerebro.turnos(nueva.id)[0]);
    ok(
      "al cerebro le llega como una conversación nueva (otro conversation.id, la misma identidad)",
      Boolean(turno) && turno.evento.messages.length === 1 && turno.evento.contact.id === contactId,
      JSON.stringify(turno?.evento?.messages?.length)
    );
  }
}

// ---------------------------------------------------------------------------
// AC4 — El contacto
// ---------------------------------------------------------------------------

async function elContacto(cerebro) {
  console.log("\n== AC4: eliminar también el contacto ==");
  const p = await persona(3, "contacto");
  const contactId = p.conv.contact.id;
  const leadAntes = (await contacto(contactId)).json?.lead?.id;
  ok("la persona tiene contacto y lead", Boolean(leadAntes));

  const r = await eliminar(p.conv.id, { contacto: true });
  ok(
    "DELETE ?contacto=1 → 200 con alcance «contacto»",
    r.res.status === 200 && r.json?.alcance === "contacto" && r.json?.agente === (cerebro ? "avisado" : "no_aplica"),
    `${r.res.status} ${JSON.stringify(r.json)}`
  );
  ok("la conversación ya no sale en la bandeja", !(await conversaciones()).some((c) => c.id === p.conv.id));
  ok("el contacto ya no existe → 404", (await contacto(contactId)).res.status === 404);
  const lista = (await api(`/api/contacts?q=${encodeURIComponent(p.nombre)}`)).json?.contacts ?? [];
  ok("ni sale en Contactos", !lista.some((c) => c.id === contactId), JSON.stringify(lista.map((c) => c.id)));
  const tablero = JSON.stringify((await api("/api/pipeline/board")).json ?? {});
  ok("ni en el Pipeline", !tablero.includes(contactId) && !tablero.includes(leadAntes));
  if (cerebro) ok("el cerebro recibió su aviso", cerebro.olvidos(p.conv.id).length === 1);

  await entranteWa(p.tel, p.nombre, `soy nuevo otra vez ${MARCA}`);
  const nueva = await convDe(p.nombre);
  ok("si vuelve a escribir es una persona nueva: otro contacto y otra conversación", Boolean(nueva) && nueva.contact.id !== contactId && nueva.id !== p.conv.id);
}

// ---------------------------------------------------------------------------
// AC8 — El cerebro no confirma
// ---------------------------------------------------------------------------

async function cerebroCaido(cerebro) {
  console.log("\n== AC8: el borrado no depende del cerebro ==");
  const a = await persona(4, "cerebro500");
  await hasta(() => cerebro.turnos(a.conv.id).length > 0);
  cerebro.estado.modo = "500";
  const r500 = await eliminar(a.conv.id);
  ok("el cerebro contesta 500 → se elimina igual, con agente «sin_confirmar»", r500.res.status === 200 && r500.json?.agente === "sin_confirmar", `${r500.res.status} ${JSON.stringify(r500.json)}`);
  ok("ya no sale en la bandeja", !(await conversaciones()).some((c) => c.id === a.conv.id));
  await sleep(2500);
  ok("y no se reintenta: un solo aviso", cerebro.olvidos(a.conv.id).length === 1, `llegaron ${cerebro.olvidos(a.conv.id).length}`);
  cerebro.estado.modo = "ok";

  const b = await persona(5, "cerebroapagado");
  await hasta(() => cerebro.turnos(b.conv.id).length > 0);
  await cerebro.apagar();
  const t0 = Date.now();
  const rApagado = await eliminar(b.conv.id);
  const tardo = Date.now() - t0;
  await cerebro.encender();
  ok("con el cerebro apagado → se elimina igual, «sin_confirmar»", rApagado.res.status === 200 && rApagado.json?.agente === "sin_confirmar", `${rApagado.res.status} ${JSON.stringify(rApagado.json)}`);
  ok("sin hacer esperar a quien elimina (menos de 10 s)", tardo < 10_000, `${tardo} ms`);
  ok("ya no sale en la bandeja", !(await conversaciones()).some((c) => c.id === b.conv.id));
}

// ---------------------------------------------------------------------------
// AC6 — Una cita por venir
// ---------------------------------------------------------------------------

async function citaPorVenir() {
  console.log("\n== AC6: una cita por venir detiene el borrado ==");
  if (!AGENDA) {
    console.log("  SKIP: la app corre sin AGENDA=on");
    return;
  }
  const todos = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "23:30" }]]));
  const conf = await api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({ weeklyHours: todos, slotMinutes: 30, minNoticeHours: 0, maxDaysAhead: 7, connector: "enlace-fijo", meetingLink: "https://meet.ejemplo.test/sala" }),
  });
  ok("agenda configurada", conf.res.ok, `${conf.res.status} ${JSON.stringify(conf.json).slice(0, 160)}`);
  const slots = (await api("/api/calendar/availability")).json?.slots ?? [];
  const slot = slots.at(-1);
  const startUtc = slot?.startUtc ?? slot?.start ?? slot?.startsAt;
  ok("hay un hueco para agendar", Boolean(startUtc), JSON.stringify(slot));
  if (!startUtc) return;

  const p = await persona(6, "cita");
  const contactId = p.conv.contact.id;
  const cita = await api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ kind: "session", contactId, conversationId: p.conv.id, startUtc }),
  });
  const bookingId = cita.json?.booking?.id ?? cita.json?.id;
  ok("la persona tiene una cita agendada por venir", cita.res.status === 201 && Boolean(bookingId), `${cita.res.status} ${JSON.stringify(cita.json).slice(0, 200)}`);

  for (const [nombre, opts] of [["el hilo", {}], ["el contacto", { contacto: true }]]) {
    const r = await eliminar(p.conv.id, opts);
    ok(
      `eliminar ${nombre} → 409 cita_pendiente que dice la fecha y manda a Citas`,
      r.res.status === 409 && r.json?.error?.code === "cita_pendiente" && /\d{4}/.test(r.json?.error?.message ?? "") && r.json?.error?.message?.includes("Citas"),
      `${r.res.status} ${JSON.stringify(r.json)}`
    );
  }
  ok("no se borró nada", (await conversaciones()).some((c) => c.id === p.conv.id) && (await contacto(contactId)).res.status === 200);

  const cancel = await api(`/api/bookings/${bookingId}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) });
  ok("se cancela la cita", cancel.res.ok, `${cancel.res.status} ${JSON.stringify(cancel.json).slice(0, 160)}`);
  const r = await eliminar(p.conv.id);
  ok("con la cita cancelada → se elimina", r.res.status === 200, `${r.res.status} ${JSON.stringify(r.json)}`);
  const citas = JSON.stringify((await api("/api/bookings")).json ?? {});
  ok("la cita cancelada se queda en el historial del contacto, sin conversación", citas.includes(bookingId) && (await contacto(contactId)).res.status === 200, "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
