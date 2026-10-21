/**
 * Self-test E2E de comportamiento — un envío fallido DEBE decir por qué.
 * Guion tests/e2e/us-envio-fallido.md.
 *
 * Reproduce un caso real: se manda una plantilla APROBADA y el operador solo
 * ve un triángulo mudo. Meta sí había explicado el motivo (error 130472,
 * "User's number is part of an experiment"): el CRM lo guardaba en
 * `message.error` y nunca lo mostraba.
 *
 * Uso: node scripts/e2e-send-failure.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y Playwright.
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const PN = "PN-FAIL-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const req = ctx.request;

console.log("== Setup ==");
let r = await req.post(`${BASE}/api/auth/sign-up/email`, {
  headers: { origin: BASE },
  data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
});
if (!r.ok())
  r = await req.post(`${BASE}/api/auth/sign-in/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@vocero.test", password: "password-e2e-123" },
  });
ok("login", r.ok());
await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-FAIL", phoneNumberId: PN, token: "tok-f" },
});

const NAME = `Destino${S}`;
await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  data: {
    phoneNumberId: PN,
    from: `521477${Math.floor(Math.random() * 9e6) + 1e6}`,
    name: NAME,
    text: "hola",
    waMessageId: `wamid.fail.${S}`,
  },
});
await new Promise((res) => setTimeout(res, 2000));

const convs = (await (await req.get(`${BASE}/api/conversations`)).json()).conversations;
const conv = convs.find((c) => c.contact.name === NAME);
ok("conversación de prueba creada", !!conv);

const sent = await req.post(`${BASE}/api/conversations/${conv.id}/messages`, {
  data: { text: "mensaje que Meta va a rechazar" },
});
ok("mensaje enviado (queda pending)", sent.ok());

let msgs = (await (await req.get(`${BASE}/api/conversations/${conv.id}/messages`)).json()).messages;
const out = msgs.filter((m) => m.direction === "out").at(-1);
ok("el DTO del mensaje incluye el campo `error`", "error" in out, JSON.stringify(Object.keys(out)));
ok("aún sin error (todavía no falla)", out.error === null, JSON.stringify(out.error));

console.log("\n== Meta responde 'failed' con el error 130472 (caso real) ==");
const waId = msgs
  .filter((m) => m.direction === "out")
  .at(-1);
// El waMessageId no viaja en el DTO: se recupera del outbox del mock.
const outbox = (await (await req.get(`${BASE}/api/dev/wa-mock/outbox`)).json()).outbox;
const waMessageId = outbox.at(-1)?.waMessageId;
ok("outbox del mock expone el wa_message_id", !!waMessageId, String(waMessageId));

const st = await req.post(`${BASE}/api/dev/wa-mock/status`, {
  data: {
    waMessageId,
    status: "failed",
    errorCode: 130472,
    errorMessage: "User's number is part of an experiment",
  },
});
ok("webhook de estado entregado", st.ok(), JSON.stringify(await st.text()));
await new Promise((res) => setTimeout(res, 1200));

msgs = (await (await req.get(`${BASE}/api/conversations/${conv.id}/messages`)).json()).messages;
const failed = msgs.find((m) => m.id === waId.id);
ok("el mensaje quedó en failed", failed?.status === "failed", failed?.status);
ok("y trae el motivo traducido, no la jerga de Meta",
   /experimento/i.test(failed?.error ?? ""), JSON.stringify(failed?.error));
ok("el motivo sugiere qué hacer (plantilla UTILITY)",
   /UTILITY/.test(failed?.error ?? ""), JSON.stringify(failed?.error));
ok("conserva el código de Meta para rastrearlo",
   /130472/.test(failed?.error ?? ""), JSON.stringify(failed?.error));

console.log("\n== El operador lo VE en el hilo ==");
const page = await ctx.newPage();
await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
await page.getByText(NAME).first().waitFor({ timeout: 20000 });
await page.getByText(NAME).first().click();
await page.getByText("mensaje que Meta va a rechazar").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

const thread = await page.locator("main, body").first().innerText();
ok("el hilo dice 'No se entregó'", thread.includes("No se entregó"), "");
ok("y explica el motivo en español", /experimento/i.test(thread));
ok("y no deja al operador con el triángulo mudo", thread.includes("130472"));

console.log("\n== En vivo por SSE (sin recargar) ==");
const sent2 = await req.post(`${BASE}/api/conversations/${conv.id}/messages`, {
  data: { text: `segundo intento ${S}` },
});
ok("segundo mensaje enviado", sent2.ok());
await page.getByText(`segundo intento ${S}`).waitFor({ timeout: 15000 });
const outbox2 = (await (await req.get(`${BASE}/api/dev/wa-mock/outbox`)).json()).outbox;
const waId2 = outbox2.at(-1)?.waMessageId;
await req.post(`${BASE}/api/dev/wa-mock/status`, {
  data: {
    waMessageId: waId2,
    status: "failed",
    errorCode: 131049,
    errorMessage: "Message not delivered to maintain healthy ecosystem",
  },
});
await page.waitForTimeout(2500);
const thread2 = await page.locator("main, body").first().innerText();
ok("el motivo aparece SIN recargar la página (evento SSE)",
   thread2.includes("131049"), thread2.slice(-200));

await page.screenshot({ path: ".tmp/e2e-fallo.png" });
await browser.close();
console.log(`\n${failures === 0 ? "TODO VERDE" : `${failures} FALLO(S)`}`);
process.exit(failures ? 1 : 0);
