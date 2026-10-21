/**
 * Self-test E2E de comportamiento — 027: importar contactos y «sin agente».
 *
 * Conduce la app real con los simuladores: importa por la misma ruta que usa
 * el diálogo, hace escribir a los importados por WhatsApp y comprueba qué
 * quedó en Contactos, en la bandeja y qué hizo (o calló) el agente.
 *
 * 036 — El agente es el cerebro falso compartido (`scripts/lib/cerebro-falso.mjs`),
 * que escucha en `BRAIN_DISPATCH_URL` y contesta por `/api/bot/*`, con el
 * interruptor del Agente encendido. «Sin agente» sigue siendo la IA en pausa
 * de la conversación: con ella el CRM no le despacha nada al cerebro.
 *
 * Uso (configuración estándar de la 036, ver `scripts/lib/cerebro-falso.mjs`):
 *   1) app corriendo (`pnpm dev`) sobre una base migrada, con
 *      BRAIN_DISPATCH_URL=http://127.0.0.1:3261/vocero/dispatch, BOT_API_KEY,
 *      WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      OPENROUTER_BASE_URL → ai-mock con OPENROUTER_API_TOKEN y
 *      OPENROUTER_MODEL, y AGENT_COALESCE_MS=1500.
 *   2) node --env-file=.env.e2e-036 scripts/e2e-importar.mjs
 *
 * Sale con código 1 si algún check falla. Guion: tests/e2e/us-importar.md.
 */
import { apagarAgente, encenderAgente, levantarCerebroFalso } from "./lib/cerebro-falso.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const COALESCE = Number(process.env.AGENT_COALESCE_MS ?? 6000);
const PN = "PN-E2E-1";
const RUN = Date.now().toString(36);
const MARCA = `#${RUN}`;
const RELOJ = String(Date.now() % 1_000_000).padStart(6, "0");
// Con el 1 de móvil mexicano a propósito: la importación tiene que guardarlo
// igual que la ingesta (52…), o la persona acabaría con dos fichas.
const conUno = (n) => `52155${RELOJ}${String(n).padStart(2, "0")}`;
const sinUno = (t) => `52${t.slice(3)}`;

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

async function api(ruta, opts = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
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

let nMensaje = 0;
const entra = (from, name, text) =>
  api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from, name, text, waMessageId: `wamid.importar.${RUN}.${++nMensaje}` }),
  });
const importar = (contacts, aiPaused) =>
  api("/api/contacts/import", { method: "POST", body: JSON.stringify({ contacts, aiPaused }) });
const contactos = async (q) =>
  (await api(`/api/contacts?q=${encodeURIComponent(q)}&archived=true`)).json?.contacts ?? [];
const porTelefono = (tel) => contactos(sinUno(tel));
const conversaciones = async () => (await api("/api/conversations")).json?.conversations ?? [];
const convDe = (contactId, ms) =>
  hasta(async () => (await conversaciones()).find((c) => c.contact?.id === contactId && c.lastInboundAt), ms);
const mensajes = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];
// Generoso: en `next dev` la primera respuesta compila /api/bot/llm y /api/bot/messages.
const respuestaDelAgente = (convId, ms = COALESCE + 30000) =>
  hasta(async () => (await mensajes(convId)).find((m) => m.direction === "out" && m.aiGenerated), ms);

let cerebro = null;

async function main() {
  cerebro = await levantarCerebroFalso({ base: BASE, botKey: process.env.BOT_API_KEY ?? "" });
  console.log("== Setup ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "Operador E2E" }) });
  if (!su.res.ok) su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  ok("registro o login del propietario", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" }) });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  const on = await encenderAgente(api);
  ok("agente encendido (contesta el cerebro falso)", on.res.ok, `${on.res.status} ${JSON.stringify(on.json)}`);

  try {
    await cincuenta();
    await sinAgente();
  } finally {
    // Apagado antes de cerrar el cerebro: el siguiente guion no debe heredarlo.
    await apagarAgente(api);
    await cerebro.esperar();
    await cerebro.apagar();
  }
  await limites();

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Un archivo de 50 renglones
// ---------------------------------------------------------------------------

async function cincuenta() {
  console.log("\n== Un archivo de 50 renglones entra completo y no duplica ==");
  const antes = (await conversaciones()).length;
  const buenos = Array.from({ length: 50 }, (_, i) => ({
    name: `Lista ${String(i + 1).padStart(2, "0")} ${MARCA}`,
    // Formatos que trae una hoja de cálculo de verdad.
    phone: i % 3 === 0 ? `+${conUno(i)}` : i % 3 === 1 ? conUno(i).replace(/(\d{3})(\d{3})(\d+)/, "$1 $2 $3") : sinUno(conUno(i)),
  }));
  const malos = [
    { name: `Sin Lada ${MARCA}`, phone: "55 1234 5678" },
    { name: `Repetido ${MARCA}`, phone: sinUno(conUno(0)) },
    { name: `Largo ${MARCA}`, phone: "5215512345678901234" },
    { name: `Vacío ${MARCA}`, phone: "sin número" },
  ];
  const r = await importar([...buenos, ...malos], false);
  ok("la importación responde 200", r.res.status === 200, `${r.res.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  ok("50 nuevos, 0 que ya existían, a nadie se le apagó el agente", r.json?.created === 50 && r.json?.existing === 0 && r.json?.paused === 0, JSON.stringify({ c: r.json?.created, e: r.json?.existing, p: r.json?.paused }));
  const motivos = (r.json?.skipped ?? []).map((s) => `${s.line}:${s.reason}`).join(",");
  ok(
    "los cuatro que no sirven vuelven con su renglón y su motivo",
    motivos === "52:sin_codigo_pais,53:repetido,54:telefono_invalido,55:sin_telefono",
    motivos
  );
  const enLista = await contactos(`Lista`);
  const mios = enLista.filter((c) => c.name.endsWith(MARCA));
  ok("los 50 salen en Contactos", mios.length === 50, `salen ${mios.length}`);
  ok(
    "guardados como los guarda la ingesta: 52…, sin el 1 de móvil ni signos",
    mios.every((c) => /^52\d{10}$/.test(c.phone ?? "")),
    JSON.stringify(mios.find((c) => !/^52\d{10}$/.test(c.phone ?? ""))?.phone)
  );
  ok("con agente y fuera del Pipeline", mios.every((c) => c.aiPaused === false && c.stageName === null), JSON.stringify(mios.find((c) => c.aiPaused || c.stageName)));
  ok("no nació ninguna conversación", (await conversaciones()).length === antes, `antes ${antes}, ahora ${(await conversaciones()).length}`);

  const otra = await importar(buenos, false);
  ok("importar otra vez el mismo archivo: 0 nuevos, 50 que ya existían", otra.json?.created === 0 && otra.json?.existing === 50, JSON.stringify(otra.json).slice(0, 120));
  ok("y siguen siendo 50", (await contactos("Lista")).filter((c) => c.name.endsWith(MARCA)).length === 50);
}

// ---------------------------------------------------------------------------
// «El agente no les responde»
// ---------------------------------------------------------------------------

async function sinAgente() {
  console.log("\n== Importar con «el agente no les responde» ==");
  const TEL_VIEJO = conUno(60);
  const TEL_MIEMBRO = conUno(61);
  const TEL_ANONIMO = conUno(62);
  const TEL_CONTROL = conUno(63);
  const NOMBRE_VIEJO = `Cliente Viejo ${MARCA}`;
  const NOMBRE_MIEMBRO = `Miembro Importado ${MARCA}`;

  // Alguien con quien ya se hablaba antes de importar.
  await entra(TEL_VIEJO, NOMBRE_VIEJO, `hola, ya soy cliente ${MARCA}`);
  let viejo = await hasta(async () => (await porTelefono(TEL_VIEJO))[0]);
  const convVieja = viejo ? await convDe(viejo.id) : null;
  ok("quien ya escribía tiene su conversación con el agente encendido", convVieja?.aiEnabled === true, JSON.stringify(convVieja?.aiEnabled));
  ok("y el agente le contestó", Boolean(convVieja && (await respuestaDelAgente(convVieja.id))));

  const r = await importar(
    [
      { name: NOMBRE_MIEMBRO, phone: `+${TEL_MIEMBRO}` },
      { name: `Otro Nombre ${MARCA}`, phone: TEL_VIEJO },
      { name: "", phone: TEL_ANONIMO },
    ],
    true
  );
  ok("2 nuevos, 1 que ya existía, 3 con el agente apagado", r.json?.created === 2 && r.json?.existing === 1 && r.json?.paused === 3, JSON.stringify(r.json).slice(0, 160));

  const hallados = await porTelefono(TEL_MIEMBRO);
  const miembro = hallados[0];
  ok("el importado existe una sola vez, marcado «sin agente» y fuera del Pipeline", hallados.length === 1 && miembro?.aiPaused === true && miembro?.stageName === null, JSON.stringify(hallados));
  ok("no le nació una conversación vacía", !(await conversaciones()).some((c) => c.contact?.id === miembro?.id));

  viejo = (await porTelefono(TEL_VIEJO))[0];
  ok("a quien ya existía no se le cambió el nombre, y quedó «sin agente»", viejo?.name === NOMBRE_VIEJO && viejo?.aiPaused === true, JSON.stringify({ n: viejo?.name, p: viejo?.aiPaused }));
  ok("su conversación quedó con la IA en pausa", (await conversaciones()).find((c) => c.id === convVieja?.id)?.aiEnabled === false);

  console.log("\n== El importado escribe: llega a la bandeja y el agente calla ==");
  await entra(TEL_MIEMBRO, "Nombre De Perfil", `gracias por el aviso ${MARCA}`);
  const convMiembro = await convDe(miembro.id);
  ok("su conversación nace con la IA en pausa", convMiembro?.aiEnabled === false, JSON.stringify(convMiembro?.aiEnabled));
  const trasEscribir = await porTelefono(TEL_MIEMBRO);
  ok("cae en el contacto importado, no en uno nuevo", trasEscribir.length === 1 && trasEscribir[0].id === miembro.id, JSON.stringify(trasEscribir.map((c) => c.id)));
  ok("y conserva el nombre del archivo, no el de su perfil de WhatsApp", trasEscribir[0]?.name === NOMBRE_MIEMBRO, JSON.stringify(trasEscribir[0]?.name));
  const convs = await conversaciones();
  ok("el mensaje está en la bandeja, sin leer", convs.find((c) => c.id === convMiembro?.id)?.unreadCount === 1);

  await entra(TEL_VIEJO, NOMBRE_VIEJO, `otra duda ${MARCA}`);
  await sleep(COALESCE + 5000);
  const salientesMiembro = (await mensajes(convMiembro.id)).filter((m) => m.direction === "out");
  const salientesViejo = (await mensajes(convVieja.id)).filter((m) => m.direction === "out");
  ok("al importado el agente no le contestó", salientesMiembro.length === 0, `salientes: ${salientesMiembro.length}`);
  ok("ni el CRM le despachó nada al cerebro", cerebro.de(convMiembro.id).length === 0, `despachos: ${cerebro.de(convMiembro.id).length}`);
  ok("ni volvió a contestarle a quien ya existía", salientesViejo.length === 1, `salientes: ${salientesViejo.length}`);

  console.log("\n== Un renglón sin nombre ==");
  const anonimo = (await porTelefono(TEL_ANONIMO))[0];
  ok("entra con el teléfono como nombre", anonimo?.name === sinUno(TEL_ANONIMO), JSON.stringify(anonimo?.name));
  await entra(TEL_ANONIMO, `Perfil Real ${MARCA}`, `hola ${MARCA}`);
  const conNombre = await hasta(async () => {
    const c = (await porTelefono(TEL_ANONIMO))[0];
    return c?.name === `Perfil Real ${MARCA}` ? c : null;
  }, 8000);
  ok("y toma su nombre de WhatsApp en cuanto escribe", Boolean(conNombre), JSON.stringify((await porTelefono(TEL_ANONIMO))[0]?.name));

  console.log("\n== A un desconocido el agente sí le contesta ==");
  await entra(TEL_CONTROL, `Prospecto ${MARCA}`, `hola, quiero información ${MARCA}`);
  const control = await hasta(async () => (await porTelefono(TEL_CONTROL))[0]);
  const convControl = control ? await convDe(control.id) : null;
  ok("su conversación nace con el agente encendido", convControl?.aiEnabled === true && control?.aiPaused === false);
  ok("y el agente le contesta", Boolean(convControl && (await respuestaDelAgente(convControl.id))));

  console.log("\n== Reencender el agente desde el contacto ==");
  const p = await api(`/api/contacts/${miembro.id}`, { method: "PATCH", body: JSON.stringify({ aiPaused: false }) });
  ok("el contacto deja de estar «sin agente»", p.json?.contact?.aiPaused === false, JSON.stringify(p.json).slice(0, 120));
  ok("y su conversación vuelve a tener agente", (await conversaciones()).find((c) => c.id === convMiembro.id)?.aiEnabled === true);
  await entra(TEL_MIEMBRO, "Nombre De Perfil", `¿siguen abiertos? ${MARCA}`);
  ok("al siguiente mensaje el agente ya le contesta", Boolean(await respuestaDelAgente(convMiembro.id)));
  const soloNombre = await api(`/api/contacts/${viejo.id}`, { method: "PATCH", body: JSON.stringify({ notes: `nota ${MARCA}` }) });
  ok(
    "editar otra cosa del contacto no toca la pausa",
    soloNombre.json?.contact?.aiPaused === true && (await conversaciones()).find((c) => c.id === convVieja.id)?.aiEnabled === false
  );
}

// ---------------------------------------------------------------------------
// Lo que no se importa
// ---------------------------------------------------------------------------

async function limites() {
  console.log("\n== Lo que no se importa ==");
  const vacio = await importar([{ name: "x", phone: "123" }], true);
  ok("un archivo sin un solo teléfono válido → 422 nothing_to_import", vacio.res.status === 422 && vacio.json?.error?.code === "nothing_to_import", `${vacio.res.status} ${JSON.stringify(vacio.json)}`);
  const nada = await importar([], false);
  ok("una lista vacía → 422", nada.res.status === 422, String(nada.res.status));
  const muchos = await importar(Array.from({ length: 2001 }, (_, i) => ({ name: `M${i}`, phone: `5215500${String(i).padStart(6, "0")}` })), false);
  ok("más de 2,000 renglones → 422, sin importar ninguno", muchos.res.status === 422 && (await contactos("M2000")).length === 0, String(muchos.res.status));
  cookie = "";
  const sinSesion = await importar([{ name: "x", phone: "5215512345678" }], false);
  ok("sin sesión → 401", sinSesion.res.status === 401, String(sinSesion.res.status));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
