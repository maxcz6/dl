/**
 * Self-test E2E de comportamiento — 215: Citas en calendario (Día, Semana,
 * Mes y Lista). Guion: tests/e2e/us-calendario.md
 *
 * Conduce la app real con un navegador en OTRA zona horaria que la del
 * negocio (Tokio contra Ciudad de México, 15 h de diferencia) para probar que
 * todo se pinta y se bloquea en la hora del NEGOCIO:
 *  - la API por rango (`?from=&to=`), sus 422 y que sin parámetros responde
 *    exactamente lo de siempre;
 *  - fallo 4: un rango trae TODAS sus citas, no las últimas 200;
 *  - las cuatro vistas, la navegación y la URL (`?vista=&fecha=`);
 *  - el panel de la cita con «Abrir conversación» y reprogramar con los huecos
 *    de toda la ventana por día (fallo 2: antes, 12);
 *  - bloquear tocando un hueco vacío, en la hora del negocio (fallo 1);
 *  - un evento SSE refresca la vista sin pedir disponibilidad (fallo 3);
 *  - las citas del Laboratorio (`is_test`) ocultas por defecto;
 *  - en el celular abre en «Día» y no desborda a lo ancho.
 * Con la agenda apagada, comprueba que la pantalla y la API son 404.
 *
 * Uso: node --env-file=.env scripts/e2e-calendario.mjs (pnpm test:e2e:calendario)
 * Requiere: app viva con WA_MOCK_ENABLED=true, BD migrada y Playwright.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const AGENDA = /^(on|1|true|si|sí|yes)$/i.test((process.env.AGENDA ?? "").trim());
const TZ_NEGOCIO = "America/Mexico_City";
const TZ_NAVEGADOR = "Asia/Tokyo";
const PN = "PN-E2E-1";
const HOUR_PX = 48; // el alto de una hora en la rejilla (time-grid.tsx)
const CORRIDA = Date.now();
const TOPE_NOTA = "e2e-215-tope";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* reintenta */
    }
    if (Date.now() - t0 > ms) return false;
    await sleep(250);
  }
}

/** Hora de pared del negocio → instante UTC (dos pasadas, como slots.ts). */
function offsetMin(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUtc - date.getTime()) / 60000;
}
function wallToUtc(day, hhmm, tz = TZ_NEGOCIO) {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ts = guess - offsetMin(new Date(guess), tz) * 60000;
  const second = offsetMin(new Date(ts), tz);
  if (second !== offsetMin(new Date(guess), tz)) ts = guess - second * 60000;
  return new Date(ts).toISOString();
}
const dayIn = (instant, tz = TZ_NEGOCIO) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant)
  );
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayIdx = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
const mondayOf = (day) => addDays(day, -weekdayIdx(day));

/** De 15 en 15: `next dev` no agradece 200 peticiones a la vez. */
async function enLotes(items, fn, n = 15) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  timezoneId: TZ_NAVEGADOR,
  locale: "es-MX",
});
const req = ctx.request;

async function api(path, opts = {}) {
  const res = await req.fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { origin: BASE, "content-type": "application/json" },
    data: opts.body,
    failOnStatusCode: false,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status(), json };
}

const created = []; // citas y bloqueos de esta corrida, para cancelarlos al final
let sql = null;
let testBookingId = null;

async function main() {
  console.log("== Setup: login ==");
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
  });
  if (su.status >= 400) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: "e2e@vocero.test", password: "password-e2e-123" },
    });
  }
  ok("registro o login del operador", su.status < 400, `status=${su.status}`);

  if (!AGENDA) {
    console.log("\n== 215: con la agenda apagada, el calendario no existe ==");
    for (const q of ["", "?from=2026-09-21&to=2026-09-27", "?from=mal"]) {
      const r = await api(`/api/bookings${q}`);
      ok(`GET /api/bookings${q} → 404`, r.status === 404, `status=${r.status}`);
    }
    const page = await ctx.newPage();
    const nav = await page.goto(`${BASE}/bookings?vista=semana&fecha=2026-09-21`, {
      waitUntil: "domcontentloaded",
    });
    ok("la pantalla /bookings es 404", nav?.status() === 404, `status=${nav?.status()}`);
    const inbox = await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    ok(
      "la navegación no ofrece «Citas»",
      inbox?.ok() && (await page.locator('a[href="/bookings"]').count()) === 0
    );
    return;
  }

  await api("/api/settings/whatsapp", {
    method: "PUT",
    body: { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" },
  });
  const settings = await api("/api/calendar/settings", {
    method: "PUT",
    body: {
      timezone: TZ_NEGOCIO,
      weeklyHours: Object.fromEntries(
        ["mon", "tue", "wed", "thu", "fri"].map((d) => [d, [{ start: "09:00", end: "18:00" }]])
      ),
      slotMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 14,
      connector: "enlace-fijo",
      meetingLink: "https://meet.ejemplo.test/calendario",
    },
  });
  ok("horario L–V 09:00–18:00 en Ciudad de México", settings.status < 400, `status=${settings.status}`);

  const LEAD = "5214627215001";
  await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: { phoneNumberId: PN, from: LEAD, name: "Lead calendario", text: "quiero una cita", waMessageId: `wamid.e2e.215.${CORRIDA}` },
  });
  let conv = null;
  await until(async () => {
    const convs = (await api("/api/conversations")).json?.conversations ?? [];
    conv = convs.find((c) => c.contact?.phone === "524627215001") ?? null;
    return conv;
  });
  ok("hay una conversación con quien agendar", Boolean(conv));
  if (!conv) return;

  // Día de las citas: el primer día hábil con huecos a partir de pasado mañana.
  const avail = (await api("/api/calendar/availability")).json?.slots ?? [];
  const hoy = dayIn(Date.now());
  const dias = [...new Set(avail.map((s) => s.dayIso))].filter((d) => d >= addDays(hoy, 2));
  const D = dias[0];
  ok("la ventana del negocio ofrece huecos", Boolean(D) && avail.length > 12, `slots=${avail.length}`);
  if (!D) return;
  const libresD = avail.filter((s) => s.dayIso === D);
  const pick = (hhmm) => libresD.find((s) => s.time === hhmm) ?? libresD.shift();
  const s10 = pick("10:00");
  const s16 = pick("16:00");

  const citas = [];
  for (const s of [s10, s16]) {
    const r = await api("/api/bookings", {
      method: "POST",
      body: { kind: "session", contactId: conv.contact.id, conversationId: conv.id, startUtc: s.startUtc },
    });
    if (r.status === 201) {
      created.push(r.json.booking.id);
      citas.push({ id: r.json.booking.id, ...s });
    }
  }
  ok("dos citas creadas por la API", citas.length === 2, JSON.stringify(citas.map((c) => c.time)));
  const comida = await api("/api/bookings", {
    method: "POST",
    body: { kind: "block", startUtc: wallToUtc(D, "13:00"), durationMinutes: 60, notes: "Comida" },
  });
  if (comida.status === 201) created.push(comida.json.booking.id);
  ok("un bloqueo creado por la API", comida.status === 201, `status=${comida.status}`);

  // Una cita del Laboratorio (is_test) a la misma hora que la primera: así la
  // crea el runner del Laboratorio, que no pasa por la API del operador.
  // `scheduled_at` es `timestamp` SIN zona y guarda UTC: va como texto ISO; un
  // Date lo mandaría como timestamptz y la sesión lo pasaría a la hora local.
  if (process.env.DATABASE_URL && citas[0]) {
    sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
    const [{ organization_id: org }] = await sql`select organization_id from booking where id = ${citas[0].id}`;
    testBookingId = `bk_e2e215${CORRIDA}`;
    await sql`insert into booking (id, organization_id, kind, status, source, contact_id, scheduled_at, duration_minutes, connector, is_test, notes)
      values (${testBookingId}, ${org}, 'session', 'agendada', 'ai', ${conv.contact.id}, ${citas[0].startUtc}::timestamp, 30, 'enlace-fijo', true, 'Prueba del Laboratorio')`;
  }

  console.log("\n== 215: la API por rango ==");
  const sinRango = await api("/api/bookings");
  ok(
    "sin parámetros responde exactamente lo de siempre ({ bookings })",
    sinRango.status === 200 && JSON.stringify(Object.keys(sinRango.json ?? {})) === '["bookings"]',
    JSON.stringify(Object.keys(sinRango.json ?? {}))
  );
  const rango = await api(`/api/bookings?from=${D}&to=${D}`);
  const idsD = new Set((rango.json?.bookings ?? []).map((b) => b.id));
  ok(
    "con from/to trae las del día, más timezone, weeklyHours, range y truncated",
    rango.status === 200 &&
      rango.json.timezone === TZ_NEGOCIO &&
      Boolean(rango.json.weeklyHours?.mon) &&
      rango.json.range?.from === D &&
      rango.json.truncated === false &&
      created.every((id) => idsD.has(id)),
    JSON.stringify({ status: rango.status, tz: rango.json?.timezone, n: idsD.size })
  );
  ok("…incluida la del Laboratorio, marcada isTest", !testBookingId || (rango.json?.bookings ?? []).some((b) => b.id === testBookingId && b.isTest));
  for (const [nombre, q] of [
    ["solo from", `?from=${D}`],
    ["fecha inexistente", "?from=2026-02-31&to=2026-03-02"],
    ["al revés", `?from=${addDays(D, 3)}&to=${D}`],
    ["93 días", `?from=${D}&to=${addDays(D, 92)}`],
  ]) {
    const r = await api(`/api/bookings${q}`);
    ok(`rango inválido (${nombre}) → 422 invalid_range`, r.status === 422 && r.json?.error?.code === "invalid_range", `status=${r.status}`);
  }
  ok("92 días sí caben", (await api(`/api/bookings?from=${D}&to=${addDays(D, 91)}`)).status === 200);

  console.log("\n== 215: fallo 4 — un rango trae todas sus citas, no las últimas 200 ==");
  // Limpieza de una corrida anterior que no terminó: el índice único no deja
  // dos bloqueos activos en el mismo instante.
  const junio = await api("/api/bookings?from=2026-06-01&to=2026-06-30");
  const viejos = (junio.json?.bookings ?? []).filter((b) => b.notes === TOPE_NOTA && b.status === "agendada");
  await enLotes(viejos, (b) => api(`/api/bookings/${b.id}`, { method: "PATCH", body: { action: "cancel" } }));
  const tope = [];
  const TOTAL = 205;
  for (let i = 0; i < TOTAL; i += 15) {
    const lote = await Promise.all(
      Array.from({ length: Math.min(15, TOTAL - i) }, (_, k) =>
        api("/api/bookings", {
          method: "POST",
          body: {
            kind: "block",
            startUtc: new Date(Date.parse(wallToUtc("2026-06-01", "00:00")) + (i + k) * 30 * 60000).toISOString(),
            durationMinutes: 15,
            notes: TOPE_NOTA,
          },
        })
      )
    );
    for (const r of lote) if (r.status === 201) tope.push(r.json.booking.id);
  }
  ok(`${TOTAL} bloqueos de junio creados`, tope.length === TOTAL, `creados=${tope.length}`);
  const todas = await api("/api/bookings");
  ok("sin rango sigue siendo el listado de 200 (compatibilidad)", todas.json?.bookings?.length === 200, `n=${todas.json?.bookings?.length}`);
  const junioDespues = await api("/api/bookings?from=2026-06-01&to=2026-06-30");
  const idsJunio = new Set((junioDespues.json?.bookings ?? []).map((b) => b.id));
  ok(
    `el rango de junio trae los ${TOTAL}, en orden ascendente`,
    tope.every((id) => idsJunio.has(id)) &&
      junioDespues.json.bookings.every((b, i, xs) => i === 0 || xs[i - 1].scheduledAtUtc <= b.scheduledAtUtc),
    `n=${idsJunio.size}`
  );
  await enLotes(tope, (id) => api(`/api/bookings/${id}`, { method: "PATCH", body: { action: "cancel" } }));

  console.log("\n== 215: el calendario en el navegador (Tokio) con el negocio en CDMX ==");
  const page = await ctx.newPage();
  // `availabilityOk`: las que terminaron. En `next dev` React monta los
  // efectos dos veces (StrictMode) y la primera petición se aborta.
  const conteo = { availability: 0, availabilityOk: 0, rango: 0 };
  page.on("requestfinished", (r) => {
    if (r.url().includes("/api/calendar/availability")) conteo.availabilityOk++;
  });
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/calendar/availability")) conteo.availability++;
    if (u.includes("/api/bookings?from=")) conteo.rango++;
  });
  await page.goto(`${BASE}/bookings?vista=semana&fecha=${D}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const titulo10 = `Lead calendario, ${s10.time} a `;
  const evento10 = page.locator(`[aria-label^="${titulo10}"]`);
  ok("la semana pinta la cita", await until(async () => (await evento10.count()) === 1, 45000), `count=${await evento10.count()}`);
  ok("la URL dice vista y fecha", page.url().includes(`vista=semana&fecha=${D}`), page.url());

  // La cita queda a la altura de SU hora del negocio, no de la de Tokio.
  const col = page.locator(`[data-day="${D}"]`);
  const [boxCol, boxEv] = [await col.boundingBox(), await evento10.first().boundingBox()];
  const [h, m] = s10.time.split(":").map(Number);
  const esperado = ((h * 60 + m) / 60) * HOUR_PX;
  ok(
    `la cita de las ${s10.time} se pinta a las ${s10.time} del negocio`,
    boxCol && boxEv && Math.abs(boxEv.y - boxCol.y - esperado) <= 3,
    `offset=${boxEv && boxCol ? boxEv.y - boxCol.y : "?"} esperado=${esperado}`
  );
  ok("la esquina dice el desfase del negocio (GMT-6)", (await page.getByText("GMT-6", { exact: true }).count()) > 0);

  console.log("\n== 215: las citas del Laboratorio, ocultas por defecto ==");
  if (testBookingId) {
    ok("la cita de prueba no se pinta por defecto", (await evento10.count()) === 1);
    const pruebas = page.getByRole("switch", { name: "Mostrar pruebas del Laboratorio" });
    await pruebas.click();
    const mostradas = await until(async () => (await evento10.count()) === 2, 5000);
    ok(
      "«Mostrar pruebas» la pinta junto a la real",
      mostradas,
      `aria-checked=${await pruebas.getAttribute("aria-checked")} eventos=${JSON.stringify(await col.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))}`
    );
    await pruebas.click();
    ok("…y apagarlo la vuelve a ocultar", await until(async () => (await evento10.count()) === 1, 5000));
  }

  console.log("\n== 215: navegación y vistas ==");
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  ok("‹ › mueve la semana y la URL", await until(async () => page.url().includes(`fecha=${addDays(D, 7)}`), 5000), page.url());
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  ok("«Hoy» vuelve al hoy del NEGOCIO", await until(async () => page.url().includes(`fecha=${hoy}`), 5000), `${page.url()} (hoy CDMX ${hoy})`);
  const vista = page.getByRole("group", { name: "Vista" });
  await vista.getByRole("button", { name: "Día" }).click();
  ok("vista Día en la URL", await until(async () => page.url().includes("vista=dia"), 5000));
  await vista.getByRole("button", { name: "Mes" }).click();
  ok("vista Mes en la URL y su cuadrícula", await until(async () => page.url().includes("vista=mes") && (await page.getByRole("button", { name: /^Ver el día \d+$/ }).count()) >= 28, 8000));
  await vista.getByRole("button", { name: "Lista" }).click();
  ok("vista Lista con Desde–Hasta en la URL", await until(async () => /vista=lista&desde=\d{4}-\d{2}-\d{2}&hasta=\d{4}-\d{2}-\d{2}/.test(page.url()), 5000), page.url());
  ok("la Lista muestra la cita", await until(async () => (await page.getByText("Lead calendario").count()) > 0, 8000));

  await page.goto(`${BASE}/bookings?vista=semana&fecha=${D}`, { waitUntil: "domcontentloaded" });
  await until(async () => (await evento10.count()) === 1, 30000);

  console.log("\n== 215: el panel de la cita y reprogramar (fallo 2) ==");
  const antesDeAbrir = conteo.availability;
  const antesDeAbrirOk = conteo.availabilityOk;
  await evento10.first().click();
  const panel = page.getByRole("dialog", { name: "Cita: Lead calendario" });
  ok("tocar la cita abre su panel", await until(async () => panel.isVisible(), 5000));
  const abrir = panel.getByRole("link", { name: "Abrir conversación" });
  ok("«Abrir conversación» lleva a su hilo", (await abrir.getAttribute("href")) === `/inbox?contact=${conv.contact.id}`, await abrir.getAttribute("href"));
  for (const b of ["Reprogramar", "Realizada", "No asistió", "Cancelar cita"]) {
    ok(`acción «${b}» presente`, (await panel.getByRole("button", { name: b }).count()) === 1);
  }
  ok("abrir el panel no pide disponibilidad", conteo.availability === antesDeAbrir, `peticiones=${conteo.availability - antesDeAbrir}`);
  await panel.getByRole("button", { name: "Reprogramar" }).click();
  const diasHuecos = panel.getByRole("group", { name: "Días con huecos" }).getByRole("button");
  await until(async () => (await diasHuecos.count()) > 0, 20000);
  const libres = await panel.locator("text=/\\d+ libres/").allTextContents();
  const totalLibres = libres.reduce((n, t) => n + Number(t.match(/\d+/)[0]), 0);
  ok(
    "reprograma con toda la ventana por día (antes, 12 huecos)",
    (await diasHuecos.count()) >= 5 && totalLibres > 12,
    `días=${await diasHuecos.count()} huecos=${totalLibres}`
  );
  ok(
    "la disponibilidad se pidió UNA vez, al abrir «Reprogramar»",
    conteo.availabilityOk === antesDeAbrirOk + 1,
    `completas=${conteo.availabilityOk - antesDeAbrirOk} emitidas=${conteo.availability - antesDeAbrir}`
  );
  const ultimoDia = diasHuecos.last();
  const diaNuevo = await ultimoDia.getAttribute("data-day");
  await ultimoDia.click();
  const hueco = panel.getByRole("group", { name: "Horarios libres" }).getByRole("button").first();
  const startNuevo = await hueco.getAttribute("data-start");
  const horaNueva = (await hueco.textContent())?.trim();
  await hueco.click();
  const movida = await until(async () => {
    const r = await api(`/api/bookings?from=${diaNuevo}&to=${diaNuevo}`);
    return (r.json?.bookings ?? []).some((b) => b.id === citas[0].id && b.scheduledAtUtc === startNuevo);
  }, 20000);
  ok(`la cita se movió al ${diaNuevo} ${horaNueva}`, movida, `start=${startNuevo}`);
  ok("el panel muestra la hora nueva", await until(async () => (await panel.textContent())?.includes(`${horaNueva} –`), 10000));
  // Si el día nuevo no se ve en la semana, el calendario salta a él.
  const fechaEsperada = diaNuevo <= addDays(mondayOf(D), 6) ? D : diaNuevo;
  ok("…y el calendario muestra ese día", await until(async () => page.url().includes(`fecha=${fechaEsperada}`), 5000), page.url());
  await page.keyboard.press("Escape");
  ok("Escape cierra el panel", await until(async () => (await panel.count()) === 0, 5000));

  console.log("\n== 215: bloquear tocando un hueco vacío, en la hora del negocio (fallo 1) ==");
  await page.goto(`${BASE}/bookings?vista=semana&fecha=${D}`, { waitUntil: "domcontentloaded" });
  await until(async () => (await page.locator(`[data-day="${D}"]`).count()) === 1, 30000);
  const D2 = weekdayIdx(D) < 4 ? addDays(D, 1) : addDays(D, -1);
  const pos = await page.evaluate(
    ({ day, y }) => {
      const colEl = document.querySelector(`[data-day="${day}"]`);
      let sc = colEl?.parentElement;
      while (sc && getComputedStyle(sc).overflowY !== "auto") sc = sc.parentElement;
      if (sc) sc.scrollTop = Math.max(0, y - 200);
      const r = colEl.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + y };
    },
    { day: D2, y: 15 * HOUR_PX + (10 / 60) * HOUR_PX }
  );
  await page.mouse.click(pos.x, pos.y);
  const dialogo = page.getByRole("dialog", { name: "Bloquear horario" });
  ok("tocar las 15:10 abre «Bloquear horario»", await until(async () => dialogo.isVisible(), 5000));
  ok(
    "…con ese día y las 15:00",
    (await page.locator("#bloqueo-dia").inputValue()) === D2 && (await page.locator("#bloqueo-hora").inputValue()) === "15:00",
    `${await page.locator("#bloqueo-dia").inputValue()} ${await page.locator("#bloqueo-hora").inputValue()}`
  );
  await page.locator("#bloqueo-nota").fill(`Bloqueo e2e ${CORRIDA}`);
  await dialogo.getByRole("button", { name: "Bloquear", exact: true }).click();
  let bloqueo = null;
  await until(async () => {
    const r = await api(`/api/bookings?from=${D2}&to=${D2}`);
    bloqueo = (r.json?.bookings ?? []).find((b) => b.notes === `Bloqueo e2e ${CORRIDA}`) ?? null;
    return bloqueo;
  }, 15000);
  if (bloqueo) created.push(bloqueo.id);
  ok(
    "el bloqueo cae a las 15:00 de CDMX, no a las 15:00 de Tokio",
    bloqueo?.scheduledAtUtc === wallToUtc(D2, "15:00") && bloqueo?.time === "15:00",
    `${bloqueo?.scheduledAtUtc} (esperado ${wallToUtc(D2, "15:00")}; con la hora del navegador sería ${wallToUtc(D2, "15:00", TZ_NAVEGADOR)})`
  );
  ok("el diálogo se cierra", await until(async () => (await dialogo.count()) === 0, 5000));
  ok("el bloqueo se pinta rayado en la rejilla", await until(async () => (await page.locator(`[aria-label^="Bloqueo e2e ${CORRIDA}, 15:00 a 16:00"]`).count()) === 1, 8000));

  console.log("\n== 215: un evento SSE refresca sin pedir disponibilidad (fallo 3) ==");
  await sleep(1500);
  const base = { ...conteo };
  const sse = await Promise.all(
    [0, 1, 2, 3, 4].map((i) =>
      api("/api/bookings", {
        method: "POST",
        body: { kind: "block", startUtc: wallToUtc(D2, `0${i + 1}:00`), durationMinutes: 30, notes: `SSE e2e ${i}` },
      })
    )
  );
  for (const r of sse) if (r.status === 201) created.push(r.json.booking.id);
  ok("5 bloqueos creados desde fuera de la pantalla", sse.every((r) => r.status === 201));
  const llegaron = await until(async () => (await page.locator('[aria-label^="SSE e2e "]').count()) === 5, 15000);
  ok("aparecen sin recargar (SSE)", llegaron, `pintados=${await page.locator('[aria-label^="SSE e2e "]').count()}`);
  await sleep(1000);
  const recargas = conteo.rango - base.rango;
  ok("ningún evento pidió disponibilidad", conteo.availability === base.availability, `peticiones=${conteo.availability - base.availability}`);
  ok(`la ráfaga de 5 eventos costó ${recargas} consulta(s) del rango`, recargas >= 1 && recargas <= 5, `recargas=${recargas}`);

  console.log("\n== 215: celular ==");
  const movil = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: TZ_NAVEGADOR,
    locale: "es-MX",
    isMobile: true,
    hasTouch: true,
  });
  await movil.addCookies(await ctx.cookies());
  const mp = await movil.newPage();
  await mp.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded", timeout: 60000 });
  ok("sin preferencia, el celular abre en «Día»", await until(async () => mp.url().includes("vista=dia"), 20000), mp.url());
  ok(
    "la página no desborda a lo ancho",
    await until(async () => mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 5000)
  );
  await movil.close();
  await page.close();
}

try {
  await main();
} catch (err) {
  failures++;
  console.log(`  FAIL excepción: ${err?.stack ?? err}`);
} finally {
  // Deja la agenda como estaba: lo creado se cancela y la cita de prueba se va.
  await Promise.all(created.map((id) => api(`/api/bookings/${id}`, { method: "PATCH", body: { action: "cancel" } })));
  if (sql && testBookingId) await sql`delete from booking where id = ${testBookingId}`;
  await sql?.end();
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} checks OK`);
process.exit(failures ? 1 : 0);
