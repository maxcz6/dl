/**
 * Self-test E2E de comportamiento — el compositor no espera a Meta
 * (guion tests/e2e/us1-inbox.md, sección "envío instantáneo").
 *
 * Conduce la UI real con Playwright: enviar con Enter tarda ~1,5 s en el viaje
 * a Meta, y durante ese rato el renglón siguiente se escribía ENCIMA del
 * anterior, así que dos frases seguidas salían como un solo mensaje.
 *
 * Uso: node --env-file=.env scripts/e2e-envio-instantaneo.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-EI-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const req = ctx.request;

console.log("== Setup: registro + conexión + una conversación ==");
const email = "e2e@vocero.test";
const password = "password-e2e-123";
let su = await req.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password, name: "Operador E2E" },
});
if (!su.ok()) {
  su = await req.post(`${BASE}/api/auth/sign-in/email`, {
    data: { email, password },
  });
}
ok("registro o login del operador", su.ok());

const conn = await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-EI", phoneNumberId: PN, token: "tok-ei" },
});
ok("conexión WhatsApp guardada", conn.ok());

const NAME = `Prospecto${S}`;
await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  data: {
    phoneNumberId: PN,
    from: `52155500${Math.floor(1000 + Math.random() * 8999)}`,
    name: NAME,
    text: "hola, ¿me pasas precios?",
  },
});
const conv = await (async () => {
  let found = null;
  await until(async () => {
    const d = await (await req.get(`${BASE}/api/conversations`)).json();
    found = (d.conversations ?? []).find((c) => c.contact.name === NAME);
    return Boolean(found);
  });
  return found;
})();
ok("conversación creada por el entrante", Boolean(conv));
if (!conv) {
  await browser.close();
  process.exit(1);
}

const outMsgs = async () => {
  const d = await (
    await req.get(`${BASE}/api/conversations/${conv.id}/messages`)
  ).json();
  return (d.messages ?? []).filter((m) => m.direction === "out");
};

// Calentar la ruta que el guion va a MEDIR: en dev su primera compilación
// tarda segundos y falsearía el tiempo de la UI.
await req.get(`${BASE}/api/conversations/${conv.id}/messages`);

const page = await ctx.newPage();
await page.goto(`${BASE}/inbox`);
await page.getByText(NAME).first().click();
const box = page.getByPlaceholder("Escribe una respuesta");
await box.waitFor({ timeout: 20000 });

console.log("\n== Enter entrega YA, y el renglón siguiente es otro mensaje ==");
const T1 = `hola ${S}`;
const T2 = `te comparto los precios ${S}`;
await box.click();
await box.fill(T1);
await box.press("Enter");

// El bug medía ~1,5 s. Se exige que el campo quede libre en menos de 300 ms,
// que es lo que tarda una persona en empezar el renglón siguiente.
const t0 = Date.now();
let vacioEn = null;
while (Date.now() - t0 < 3000) {
  if ((await box.inputValue()) === "") {
    vacioEn = Date.now() - t0;
    break;
  }
  await sleep(20);
}
ok(
  "el compositor se limpia en menos de 300 ms",
  vacioEn !== null && vacioEn < 300,
  vacioEn === null ? "nunca se limpió" : `tardó ${vacioEn} ms`
);
ok(
  "la burbuja aparece sin esperar la confirmación del servidor",
  (await page.getByText(T1, { exact: true }).count()) > 0
);

await box.fill(T2);
await box.press("Enter");

await until(async () => (await outMsgs()).length >= 2, 25000);
const outs = await outMsgs();
const textos = outs.map((m) => m.text);
ok(
  "salieron DOS mensajes separados (no uno con todo pegado)",
  outs.length === 2,
  JSON.stringify(textos)
);
ok(
  "y en el orden en que se escribieron",
  textos[0] === T1 && textos[1] === T2,
  JSON.stringify(textos)
);
// Espera ACTIVA y acotada al hilo: entre que llega el mensaje real y se retira
// el provisional hay un instante con los dos, y el preview de la lista lateral
// también repite el texto. Lo que se afirma es el estado en reposo.
const hilo = page
  .locator("section")
  .filter({ has: page.getByPlaceholder("Escribe una respuesta") });
const burbujasT1 = async () => hilo.getByText(T1, { exact: true }).count();
const sinDuplicado = await until(async () => (await burbujasT1()) === 1, 10000);
ok(
  "el hilo no duplica la burbuja al llegar el mensaje real",
  sinDuplicado,
  `quedaron ${await burbujasT1()}`
);

const outbox = await (await req.get(`${BASE}/api/dev/wa-mock/outbox`)).json();
const enMeta = (outbox.outbox ?? [])
  .map((o) => o.body?.text?.body ?? "")
  .filter((t) => t.includes(S));
ok(
  "a WhatsApp llegaron en el mismo orden",
  enMeta.length >= 2 && enMeta[0].includes(T1) && enMeta[1].includes(T2),
  JSON.stringify(enMeta)
);

console.log("\n== Camino infeliz: lo que no salió vuelve al compositor ==");
await page.route("**/api/conversations/*/messages", async (route) => {
  if (route.request().method() !== "POST") return route.fallback();
  await route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "meta_error", message: "Meta no responde" } }),
  });
});
const T3 = `esto no va a salir ${S}`;
await box.fill(T3);
await box.press("Enter");

const volvio = await until(async () => (await box.inputValue()).includes(T3), 8000);
ok("el texto rechazado regresa al campo, no se pierde", volvio);
ok(
  "y el error se muestra en el compositor",
  (await page.getByText(/Meta no responde/i).count()) > 0
);
// El texto SÍ sigue en pantalla, pero dentro del compositor (acaba de volver).
// Lo que no debe quedar es una burbuja en el hilo, así que el compositor se
// excluye a mano: contarlo daría un falso fallo.
const rastros = await page.getByText(T3, { exact: true }).all();
const enElHilo = [];
for (const nodo of rastros) {
  const esCampo = await nodo.evaluate((el) => el.tagName === "TEXTAREA");
  if (!esCampo) enElHilo.push(nodo);
}
ok(
  "la burbuja provisional se retira cuando el envío falla",
  enElHilo.length === 0,
  `quedan ${enElHilo.length} en el hilo`
);
await page.unroute("**/api/conversations/*/messages");

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
