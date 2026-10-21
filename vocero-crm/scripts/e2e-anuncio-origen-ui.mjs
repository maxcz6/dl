/**
 * Self-test E2E de comportamiento — de qué anuncio llegó cada conversación
 * (018), en un navegador de verdad. Guion: tests/e2e/us-atribucion.md.
 *
 * La sección 018 de `e2e-selftest.mjs` prueba que los datos llegan; este prueba
 * que se VEN: la marca en la lista, el filtro, la tarjeta con la imagen cargada
 * (no un ícono roto), la ausencia de tarjeta en una conversación orgánica, el
 * cajón del trato, los dos temas y el teléfono sin desborde. De paso deja las
 * capturas.
 *
 * Se prepara solo: mete por el wa-mock dos conversaciones de anuncio y una
 * orgánica, así no depende de lo que haya dejado otro guion.
 *
 * Uso: node --env-file=.env scripts/e2e-anuncio-origen-ui.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y Playwright.
 * Capturas en CAPTURAS_DIR (por defecto scratch/anuncio-origen). Con
 * CAPTURA=1 los nombres van sin el sufijo de corrida (para una base limpia).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-ANUNCIO-UI";
const SALIDA = process.env.CAPTURAS_DIR ?? "scratch/anuncio-origen";
const ATRIBUYE = /^(on|1|true|si|sí|yes)$/i.test((process.env.ATRIBUCION ?? "").trim());
const RUN = Date.now().toString(36).slice(-5);
const DIG = String(Date.now()).slice(-6);
const SUF = process.env.CAPTURA === "1" ? "" : ` ${RUN}`;
let ORIGEN_MOCK = BASE;
try {
  ORIGEN_MOCK = new URL(process.env.META_GRAPH_BASE_URL).origin;
} catch {
  /* sin META_GRAPH_BASE_URL: el propio BASE */
}

const TITULAR = "Taller de ventas por WhatsApp";
const TITULAR_VIDEO = "Diagnóstico gratis para tu negocio";
const CON_ANUNCIO = `Lucía Hernández${SUF}`;
const CON_VIDEO = `Mario Ruiz${SUF}`;
const ORGANICO = `Pedro Gómez${SUF}`;

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Playwright trae su Chromium; si en esta máquina no está, se usa el del sistema.
const candidatos = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];
let browser;
try {
  browser = await chromium.launch();
} catch {
  const executablePath = candidatos.find((p) => existsSync(p));
  browser = await chromium.launch(executablePath ? { executablePath } : {});
}
mkdirSync(SALIDA, { recursive: true });

const ctx = await browser.newContext({ viewport: DESKTOP });
// El canal SSE se corta: cada stream vivo ocupa una ranura de `next dev` y a
// la ~15ª carga el servidor deja de contestar. La imagen se espera por la API
// antes de abrir la página, así que la tarjeta no depende del refetch en vivo.
await ctx.route("**/api/events*", (route) => route.abort());
await ctx.addInitScript(() => localStorage.setItem("vocero.panelOpen", "true"));
ctx.setDefaultNavigationTimeout(120000);
ctx.setDefaultTimeout(30000);
const req = ctx.request;

let paso = "preparación";
let page = null;
try {
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
    data: { wabaId: "WABA-ANUNCIO-UI", phoneNumberId: PN, token: "tok-ui" },
  });

  let n = 0;
  const entra = async (datos) => {
    const res = await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
      data: { phoneNumberId: PN, waMessageId: `wamid.ui.018.${RUN}.${++n}`, ...datos },
    });
    if (!res.ok()) throw new Error(`inbound respondió ${res.status()}`);
  };
  await entra({
    from: `5215560${DIG}`,
    name: CON_ANUNCIO,
    text: "Hola, quiero información del taller",
    referral: {
      source_url: `https://fb.me/taller-${RUN}`,
      source_id: `12099${DIG}1`,
      source_type: "ad",
      headline: TITULAR,
      body: "Aprende a vender por WhatsApp en dos sesiones. Cupo limitado.",
      media_type: "image",
      image_url: `${ORIGEN_MOCK}/api/dev/wa-mock/media-file/creativo-taller-${RUN}`,
      ctwa_clid: `clid-ui-${RUN}-1`,
    },
  });
  await entra({
    from: `5215561${DIG}`,
    name: CON_VIDEO,
    text: "¿El diagnóstico tiene costo?",
    referral: {
      source_url: `https://fb.me/diagnostico-${RUN}`,
      source_id: `12099${DIG}2`,
      source_type: "ad",
      headline: TITULAR_VIDEO,
      body: "Te decimos en 20 minutos qué frena tus ventas.",
      media_type: "video",
      video_url: `${ORIGEN_MOCK}/api/dev/wa-mock/media-file/video-${RUN}`,
      thumbnail_url: `${ORIGEN_MOCK}/api/dev/wa-mock/media-file/creativo-diagnostico-${RUN}`,
    },
  });
  await entra({ from: `5215562${DIG}`, name: ORGANICO, text: "Buenas tardes, ¿tienen envíos?" });

  // La imagen se copia en segundo plano: se espera a que la API la tenga.
  const conImagen = async (nombre) => {
    for (let i = 0; i < 60; i++) {
      const lista = await (await req.get(`${BASE}/api/conversations`)).json();
      const conv = lista.conversations.find((c) => c.contact.name === nombre);
      if (conv) {
        const d = await (await req.get(`${BASE}/api/contacts/${conv.contact.id}`)).json();
        if (d.anuncio?.imageAssetId) return d.anuncio;
      }
      await sleep(400);
    }
    return null;
  };
  const anuncio = await conImagen(CON_ANUNCIO);
  const anuncioVideo = await conImagen(CON_VIDEO);
  ok("las dos imágenes de creativo quedaron guardadas", !!anuncio && !!anuncioVideo);
  // Calienta las rutas por HTTP: la primera visita compila y un goto con SSE
  // vivo a la vez atasca el servidor de desarrollo.
  for (const ruta of ["/inbox", "/pipeline"]) await req.get(`${BASE}${ruta}`, { timeout: 180000 });

  // El botón flotante de `next dev` tapa la esquina de la barra lateral: no es
  // parte del producto y no va en las capturas.
  const captura = async (p, archivo) => {
    await p.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
    await p.screenshot({ path: `${SALIDA}/${archivo}` });
  };
  const desborda = (p) =>
    p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const fila = (p, nombre) => p.getByRole("button").filter({ hasText: nombre }).first();
  const tarjeta = (p) => p.locator("[data-anuncio-origen]").first();
  const imagenCargada = (p) =>
    p.waitForFunction(() => {
      const img = document.querySelector("[data-anuncio-origen] img");
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });

  for (const tema of ["light", "dark"]) {
    await ctx.addCookies([{ name: "vocero-theme", value: tema, url: BASE }]);
    page = await ctx.newPage();
    await page.setViewportSize(DESKTOP);

    paso = `bandeja ${tema} 1440`;
    console.log(`== ${tema} · escritorio ==`);
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await fila(page, CON_ANUNCIO).getByText(`Anuncio · ${TITULAR}`).waitFor();
    ok("el renglón del anuncio dice «Anuncio · titular»", true);
    ok(
      "la conversación orgánica no lleva marca",
      (await fila(page, ORGANICO).getByText("Anuncio ·", { exact: false }).count()) === 0
    );
    const filtro = page.getByRole("button", { name: /^Anuncios/ });
    ok("hay filtro «Anuncios»", (await filtro.count()) === 1);
    await filtro.click();
    await fila(page, CON_ANUNCIO).waitFor();
    ok(
      "el filtro deja solo las de anuncios",
      (await page.getByRole("button").filter({ hasText: ORGANICO }).count()) === 0
    );

    paso = `panel ${tema} 1440`;
    await fila(page, CON_ANUNCIO).click();
    await tarjeta(page).getByText("Llegó por un anuncio").waitFor();
    await tarjeta(page).getByText(TITULAR, { exact: true }).waitFor();
    await imagenCargada(page);
    ok("la tarjeta del panel trae la imagen cargada", true);
    const href = await tarjeta(page).getByRole("link", { name: /Ver anuncio/ }).getAttribute("href");
    ok("«Ver anuncio» lleva al enlace https de Meta", href === `https://fb.me/taller-${RUN}`, href);
    ok(
      "el identificador de clic no se ve en pantalla",
      (await page.getByText(`clid-ui-${RUN}`, { exact: false }).count()) === 0
    );
    ok(
      ATRIBUYE
        ? "con ATRIBUCION encendida dice «Meta identificó el clic»"
        : "con ATRIBUCION apagada no dice «Meta identificó el clic»",
      (await tarjeta(page).getByText("Meta identificó el clic").count()) === (ATRIBUYE ? 1 : 0)
    );
    await captura(page, `bandeja-panel-${tema}-1440.png`);

    paso = `video y orgánica ${tema} 1440`;
    await fila(page, CON_VIDEO).click();
    await tarjeta(page).getByText(TITULAR_VIDEO, { exact: true }).waitFor();
    ok("un anuncio de video lo dice en la tarjeta", (await tarjeta(page).getByText("con video", { exact: false }).count()) === 1);
    await page.getByRole("button", { name: /^Todas/ }).click();
    await fila(page, ORGANICO).click();
    await page.waitForResponse((res) => res.url().includes("/api/contacts/") && res.ok());
    await sleep(500);
    ok("una conversación orgánica no enseña tarjeta", (await page.locator("[data-anuncio-origen]").count()) === 0);

    paso = `cajón ${tema} 1440`;
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(`Abrir el trato de ${CON_ANUNCIO}`).first().click();
    await tarjeta(page).getByText(TITULAR, { exact: true }).waitFor();
    await imagenCargada(page);
    ok("el cajón del trato trae la misma tarjeta", true);
    await captura(page, `cajon-${tema}-1440.png`);

    paso = `bandeja ${tema} 390`;
    console.log(`== ${tema} · teléfono ==`);
    await page.setViewportSize(PHONE);
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded" });
    await fila(page, CON_ANUNCIO).getByText(`Anuncio · ${TITULAR}`).waitFor();
    await page.getByRole("button", { name: /^Anuncios/ }).waitFor();
    ok("a 390 px la bandeja no se desborda", !(await desborda(page)));
    await captura(page, `bandeja-${tema}-390.png`);
    await fila(page, CON_ANUNCIO).click();
    await page.getByRole("button", { name: "Mostrar detalles" }).click();
    await tarjeta(page).getByText(TITULAR, { exact: true }).waitFor();
    await imagenCargada(page);
    ok("a 390 px el panel con la tarjeta no se desborda", !(await desborda(page)));
    await captura(page, `panel-${tema}-390.png`);

    paso = `cajón ${tema} 390`;
    await page.goto(`${BASE}/pipeline`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(`Abrir el trato de ${CON_ANUNCIO}`).first().click();
    await tarjeta(page).getByText(TITULAR, { exact: true }).waitFor();
    await imagenCargada(page);
    ok("a 390 px el cajón del trato trae la tarjeta", true);
    await captura(page, `cajon-${tema}-390.png`);
    await page.close();
    page = null;
  }
} catch (error) {
  failures++;
  console.log(`  ✗ se detuvo en «${paso}»: ${error instanceof Error ? error.message : error}`);
  if (page) await page.screenshot({ path: `${SALIDA}/fallo.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nUI ANUNCIO DE ORIGEN VERDE" : `\nUI ANUNCIO DE ORIGEN ROJA (${failures})`);
process.exit(failures === 0 ? 0 : 1);
