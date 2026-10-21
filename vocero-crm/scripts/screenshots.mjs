/**
 * Regenera las capturas del README (docs/screenshots/*.png) con la interfaz
 * actual, para que la portada no envejezca respecto al producto.
 *
 * Corre contra una app LOCAL con los mocks encendidos (WA_MOCK_ENABLED=true y
 * META_GRAPH_BASE_URL apuntando al wa-mock, ver el quickstart) y una base
 * recién migrada o con la demo ya cargada:
 *
 *   node --env-file=.env scripts/screenshots.mjs
 *
 * Requiere Playwright (devDependency) con su Chromium instalado:
 *
 *   pnpm exec playwright install chromium
 *
 * Lo que hace: entra (o crea al propietario si la base está vacía), carga el
 * negocio demo, conecta un número de prueba por el mock y deja la marca por
 * defecto; después captura las cinco pantallas de la portada a 1440×900 en
 * tema claro. No toca ninguna API real: todo sale del mock.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const OUT = "docs/screenshots";
const VIEWPORT = { width: 1440, height: 900 };
const EMAIL = process.env.SCREENSHOTS_EMAIL ?? "capturas@vocero.test";
const PASSWORD = process.env.SCREENSHOTS_PASSWORD ?? "capturas-vocero-123";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  locale: "es-MX",
  timezoneId: "America/Mexico_City",
  colorScheme: "light",
  reducedMotion: "reduce",
});

// La Bandeja abre el panel de detalles según esta preferencia de escritorio.
await context.addInitScript(() => {
  try {
    localStorage.setItem("vocero.panelOpen", "true");
  } catch {
    // sin almacenamiento no hay preferencia que recordar
  }
});

// --- Sesión. La API y el navegador comparten las cookies del contexto, así
// que entrar por la API deja al navegador ya autenticado.
const api = context.request;
const call = (path, init = {}) =>
  api.fetch(`${BASE}${path}`, {
    ...init,
    // Better Auth valida Origin (CSRF) en los endpoints de auth.
    headers: { origin: BASE, ...(init.headers ?? {}) },
  });

let session = await call("/api/auth/sign-up/email", {
  method: "POST",
  data: { email: EMAIL, password: PASSWORD, name: "Kevin" },
});
if (!session.ok()) {
  session = await call("/api/auth/sign-in/email", {
    method: "POST",
    data: { email: EMAIL, password: PASSWORD },
  });
}
if (!session.ok()) {
  console.error("No se pudo entrar:", session.status(), await session.text());
  process.exit(1);
}

// Demo (409 si ya hay datos: no pasa nada), número de prueba por el mock y la
// marca tal cual sale de la caja.
await call("/api/seed/demo", { method: "POST" });
await call("/api/settings/whatsapp", {
  method: "PUT",
  data: { wabaId: "waba-demo", phoneNumberId: "pn-demo-001", token: "token-demo" },
});
await call("/api/settings/branding", {
  method: "PUT",
  data: { name: "Vocero", accent: "#0d5bff", currency: "MXN" },
});

const page = await context.newPage();

/**
 * Navega, espera lo que identifica la pantalla y captura. `load` y no
 * `networkidle`: la Bandeja mantiene abierta la conexión SSE de /api/events y
 * la red jamás queda ociosa.
 */
async function shoot(path, file, ready) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  // El indicador de desarrollo de Next no es parte del producto.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await ready();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${file}`, animations: "disabled" });
  console.log("  ✓", file);
}

await shoot("/inbox", "bandeja.png", async () => {
  await page.getByRole("button", { name: /María Fernanda/ }).first().click();
  await page.getByText("¿Tienen taladros inalámbricos?").waitFor();
  await page.getByText("Etapa del pipeline").waitFor();
});

await shoot("/pipeline", "pipeline.png", async () => {
  await page.getByText("Interesado").first().waitFor();
  await page.getByText("María Fernanda López").first().waitFor();
});

await shoot("/lab", "laboratorio.png", async () => {
  await page.getByText(/Score 83/).first().waitFor();
  // El reporte de la corrida llega en un segundo fetch: se espera a que el
  // hueco "elige una corrida" desaparezca, no un tiempo fijo.
  await page
    .getByText("Elige una corrida del historial")
    .waitFor({ state: "hidden", timeout: 20_000 });
});

await shoot("/settings/branding", "marca.png", async () => {
  await page.getByText("Marca del CRM").waitFor();
  await page.getByText("Logo del negocio").waitFor();
});

await shoot("/settings/whatsapp", "wizard-whatsapp.png", async () => {
  await page.getByText(/Número conectado/).waitFor();
});

await browser.close();
console.log(`Listo: ${OUT}/*.png a ${VIEWPORT.width}×${VIEWPORT.height}`);
