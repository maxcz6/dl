/**
 * Self-test E2E de la 037 — adjuntos en disco o en un bucket S3-compatible
 * (specs/037-almacenamiento/spec.md, AC1–AC4), contra un MinIO local.
 *
 * La app se reinicia con otro entorno entre fases, así que el guion corre en
 * tres pasadas que se pasan el estado (org, assets, huellas) por un JSON:
 *
 *   disco   — app SIN MEDIA_STORE (AC1). Sube un icono y recibe una imagen
 *             por el wa-mock: los dos quedan en MEDIA_DIR y se sirven.
 *   bucket  — app con MEDIA_STORE=bucket + MEDIA_BUCKET_* (AC2, AC4). Lo de
 *             la fase disco se sigue sirviendo; con MinIO caído un icono cae
 *             al disco y `mediaWritable` pasa a false; con MinIO de vuelta,
 *             un icono, una imagen entrante y un adjunto saliente van al
 *             bucket (están en MinIO y NO en el disco) y se sirven.
 *   vuelta  — app SIN MEDIA_STORE pero CON las MEDIA_BUCKET_* (AC3): lo que
 *             quedó en el bucket se sigue sirviendo.
 *
 * Preparación (una vez):
 *   - MinIO: docker run -d --name vocero-037-minio -p 9100:9000 \
 *       --env-file .env.e2e-037-minio coollabsio/minio:RELEASE.2025-10-15T17-29-55Z server /data
 *     (minio/minio y minio/mc ya no están en Docker Hub; esta es la de Coolify)
 *     y el bucket: docker exec vocero-037-minio sh -c \
 *       'mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mb local/<bucket>'
 *     (`.env.e2e-037-minio` trae MINIO_ROOT_USER/PASSWORD generados en local;
 *     MinIO sin región propia acepta `us-east-1` y también `auto`).
 *   - BD nueva migrada; entorno base `.env.e2e-037` (el de la 036 con
 *     WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock y su MEDIA_DIR).
 *   - `.env.e2e-037-bucket`: MEDIA_STORE=bucket + MEDIA_BUCKET_ENDPOINT,
 *     _NAME, _REGION, _KEY_ID, _SECRET (las mismas llaves que el MinIO).
 *     `.env.e2e-037-vuelta`: las mismas MEDIA_BUCKET_* sin MEDIA_STORE.
 *
 * Uso (la app y el guion con el MISMO entorno; reiniciar `next dev` entre fases):
 *   node --env-file=.env.e2e-037 scripts/e2e-almacenamiento.mjs disco
 *   node --env-file=.env.e2e-037 --env-file=.env.e2e-037-bucket scripts/e2e-almacenamiento.mjs bucket
 *   node --env-file=.env.e2e-037 --env-file=.env.e2e-037-vuelta scripts/e2e-almacenamiento.mjs vuelta
 *
 * Variables del guion: APP_BASE_URL, MEDIA_DIR (relativo al cwd, como la app),
 * MEDIA_BUCKET_NAME, E2E_037_ESTADO (JSON del estado; por defecto en el tmp
 * del sistema) y E2E_037_MINIO (contenedor de MinIO; `vocero-037-minio`).
 * La fase bucket para y arranca ese contenedor con `docker` (AC4) y lee el
 * bucket con el `mc` de dentro del contenedor, con sus propias credenciales:
 * ninguna llave pasa por argv.
 *
 * Sale con código 1 si algún check falla.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const FASE = process.argv[2];
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? "./.dev-media");
const BUCKET = process.env.MEDIA_BUCKET_NAME ?? "";
const MINIO = process.env.E2E_037_MINIO ?? "vocero-037-minio";
const ESTADO = process.env.E2E_037_ESTADO ?? path.join(os.tmpdir(), "vocero-e2e-037.json");
const PN = "PN-E2E-037";
const LEAD = "5214627037001";

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

async function api(ruta, opts = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    ...opts,
    headers: {
      ...(typeof opts.body === "string" ? { "content-type": "application/json" } : {}),
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
async function hasta(cond, ms = 15000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** PNG 1×1 real seguido de una marca: el sniff solo mira la cabecera, y la
 *  marca hace que cada icono subido sea distinguible por su huella. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const pngMarcado = (marca) => Buffer.concat([PNG_1X1, Buffer.from(`e2e-037:${marca}:${randomBytes(6).toString("hex")}`)]);

// ---------------------------------------------------------------- estado

function leerEstado() {
  if (!existsSync(ESTADO)) return null;
  return JSON.parse(readFileSync(ESTADO, "utf8"));
}

function guardarEstado(estado) {
  mkdirSync(path.dirname(ESTADO), { recursive: true });
  writeFileSync(ESTADO, JSON.stringify(estado, null, 2));
}

// ---------------------------------------------------------------- disco y bucket

/** El binario en MEDIA_DIR, o null si no está. */
function enDisco(org, asset) {
  const f = path.join(MEDIA_DIR, org, asset);
  return existsSync(f) ? readFileSync(f) : null;
}

/** La org dueña de un archivo con estos bytes, buscando en MEDIA_DIR. */
function orgDelArchivo(asset, bytes) {
  if (!existsSync(MEDIA_DIR)) return null;
  for (const d of readdirSync(MEDIA_DIR)) {
    const b = enDisco(d, asset);
    if (b && b.equals(bytes)) return d;
  }
  return null;
}

function docker(args, opts = {}) {
  return execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
}

/** El objeto del bucket leído por el `mc` del contenedor, o null. */
function enBucket(org, asset) {
  if (!/^[\w.-]+$/.test(org) || !/^[\w.-]+$/.test(asset) || !/^[\w.-]+$/.test(BUCKET)) {
    throw new Error("llave inválida");
  }
  try {
    return docker([
      "exec",
      MINIO,
      "sh",
      "-c",
      `mc alias set e2e http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 && mc cat e2e/${BUCKET}/${org}/${asset}`,
    ]);
  } catch {
    return null;
  }
}

async function minioVivo() {
  try {
    const url = new URL(process.env.MEDIA_BUCKET_ENDPOINT ?? "http://127.0.0.1:9100");
    const r = await fetch(`${url.origin}/minio/health/live`);
    return r.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- app

async function login() {
  const email = "e2e-037@vocero.test";
  const password = "password-e2e-037";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E 037" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del propietario", su.res.ok, JSON.stringify(su.json));
  return su.res.ok;
}

async function salud() {
  return (await api("/api/health")).json ?? {};
}

async function subirIcono(bytes) {
  const r = await api("/api/settings/branding/favicon", {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: bytes,
  });
  return r.res.ok;
}

async function iconoServido() {
  const r = await fetch(`${BASE}/api/branding/favicon?v=${Date.now()}`);
  return { status: r.status, mime: r.headers.get("content-type") ?? "", bytes: Buffer.from(await r.arrayBuffer()) };
}

async function medioServido(assetId) {
  const r = await fetch(`${BASE}/api/media/${assetId}`, { headers: { cookie, origin: BASE } });
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) };
}

async function conversacionDelLead() {
  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  return convs.find((c) => (c.contact?.phone ?? "").endsWith("4627037001")) ?? null;
}

async function mensajes(convId) {
  return (await api(`/api/conversations/${convId}/messages`)).json?.messages ?? [];
}

/** Una imagen entrante por el wa-mock; devuelve el mensaje ya descargado. */
async function imagenEntrante(etiqueta) {
  const caption = `foto ${etiqueta} ${randomBytes(3).toString("hex")}`;
  const r = await api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from: LEAD,
      name: "Lead 037",
      type: "image",
      mediaId: `media-e2e-037-${etiqueta}-${randomBytes(3).toString("hex")}`,
      caption,
      waMessageId: `wamid.e2e.037.${etiqueta}.${randomBytes(4).toString("hex")}`,
    }),
  });
  ok(`imagen entrante (${etiqueta}) entregada al webhook`, r.res.ok, JSON.stringify(r.json));
  let msg = null;
  await hasta(async () => {
    const conv = await conversacionDelLead();
    if (!conv) return false;
    msg = (await mensajes(conv.id)).find((m) => m.media?.caption === caption) ?? null;
    return msg?.media?.fetchStatus === "available";
  }, 20000);
  ok(
    `imagen entrante (${etiqueta}) descargada y disponible`,
    msg?.media?.fetchStatus === "available",
    JSON.stringify(msg?.media)
  );
  return msg;
}

async function conectarWhatsApp() {
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E-037", phoneNumberId: PN, token: "tok-e2e-037" }),
  });
  ok("conexión WhatsApp guardada (vía wa-mock)", conn.res.ok, JSON.stringify(conn.json));
}

// ---------------------------------------------------------------- fases

async function faseDisco() {
  console.log("== disco: sin MEDIA_STORE (AC1) ==");
  if (process.env.MEDIA_STORE || process.env.MEDIA_BUCKET_ENDPOINT) {
    console.error("La fase disco corre sin MEDIA_STORE ni MEDIA_BUCKET_*.");
    process.exit(1);
  }
  const h = await salud();
  ok("health: features.media = disco", h.features?.media === "disco", JSON.stringify(h.features));
  ok("health: mediaWritable = true", h.mediaWritable === true);
  ok("health: no menciona el bucket", !/bucket_|MEDIA_BUCKET|9100/i.test(JSON.stringify(h)), JSON.stringify(h));

  if (!(await login())) return;
  await conectarWhatsApp();

  const icono = pngMarcado("disco");
  ok("icono subido (disco)", await subirIcono(icono));
  const org = orgDelArchivo("favicon", icono);
  ok("el icono quedó en MEDIA_DIR/{org}/favicon", !!org, MEDIA_DIR);
  const servido = await iconoServido();
  ok("el icono del disco se sirve", servido.status === 200 && servido.bytes.equals(icono), servido.mime);

  const msg = await imagenEntrante("disco");
  const assetId = msg?.media?.assetId;
  const binDisco = org && assetId ? enDisco(org, assetId) : null;
  ok("la imagen entrante quedó en MEDIA_DIR/{org}/{asset}", !!binDisco);
  const med = assetId ? await medioServido(assetId) : { status: 0, bytes: Buffer.alloc(0) };
  ok("la imagen entrante del disco se sirve", med.status === 200 && !!binDisco && med.bytes.equals(binDisco));

  guardarEstado({
    org,
    disco: { icono: sha(icono), entrante: assetId, entranteSha: binDisco ? sha(binDisco) : null },
  });
}

async function faseBucket() {
  console.log("== bucket: MEDIA_STORE=bucket contra MinIO (AC2, AC4) ==");
  const estado = leerEstado();
  if (!estado?.org || !estado.disco?.entrante) {
    console.error(`Sin estado de la fase disco en ${ESTADO}: corre antes la fase disco.`);
    process.exit(1);
  }
  if (process.env.MEDIA_STORE !== "bucket" || !BUCKET) {
    console.error("La fase bucket corre con MEDIA_STORE=bucket y las MEDIA_BUCKET_*.");
    process.exit(1);
  }
  const { org } = estado;
  ok("MinIO responde", await minioVivo());

  const h = await salud();
  ok("health: features.media = bucket", h.features?.media === "bucket", JSON.stringify(h.features));
  ok("health: mediaWritable = true (sondeo PUT+DELETE en el bucket)", h.mediaWritable === true, JSON.stringify(h));
  const cuerpo = JSON.stringify(h);
  ok(
    "health: sin endpoint ni llaves del bucket",
    !cuerpo.includes(process.env.MEDIA_BUCKET_SECRET ?? "\0") &&
      !cuerpo.includes(process.env.MEDIA_BUCKET_KEY_ID ?? "\0") &&
      !cuerpo.includes("9100")
  );

  if (!(await login())) return;
  await conectarWhatsApp();

  console.log("-- AC2: lo escrito antes en disco se sigue sirviendo --");
  const viejoIcono = await iconoServido();
  ok("el icono de la fase disco se sirve", sha(viejoIcono.bytes) === estado.disco.icono);
  const viejo = await medioServido(estado.disco.entrante);
  ok("la imagen entrante de la fase disco se sirve", viejo.status === 200 && sha(viejo.bytes) === estado.disco.entranteSha);

  console.log("-- AC4: bucket caído al escribir --");
  docker(["stop", MINIO]);
  ok("MinIO detenido", await hasta(async () => !(await minioVivo()), 15000));
  const iconoCaido = pngMarcado("caido");
  ok("icono subido con el bucket caído (no falla)", await subirIcono(iconoCaido));
  const enDiscoCaido = enDisco(org, "favicon");
  ok("el icono cayó al disco", !!enDiscoCaido && enDiscoCaido.equals(iconoCaido));
  const servidoCaido = await iconoServido();
  ok("el icono caído al disco se sirve", servidoCaido.bytes.equals(iconoCaido));
  // El sondeo se recuerda 60 s: se espera a que caduque y vuelva a probar.
  let hCaida = {};
  const vioCaida = await hasta(async () => {
    hCaida = await salud();
    return hCaida.mediaWritable === false;
  }, 80000, 3000);
  ok("health: mediaWritable = false con el bucket caído", vioCaida, JSON.stringify(hCaida));
  ok("health sigue ok=true (no tumba el healthcheck)", hCaida.ok === true);

  docker(["start", MINIO]);
  ok("MinIO de vuelta", await hasta(minioVivo, 30000, 500));
  let hVuelta = {};
  const vioVuelta = await hasta(async () => {
    hVuelta = await salud();
    return hVuelta.mediaWritable === true;
  }, 80000, 3000);
  ok("health: mediaWritable vuelve a true", vioVuelta, JSON.stringify(hVuelta));

  console.log("-- AC2: lo nuevo va al bucket y se sirve --");
  const icono = pngMarcado("bucket");
  ok("icono subido (bucket)", await subirIcono(icono));
  const iconoEnBucket = enBucket(org, "favicon");
  ok("el icono está en el bucket", !!iconoEnBucket && iconoEnBucket.equals(icono));
  const iconoEnDisco = enDisco(org, "favicon");
  // El icono es una llave FIJA: la copia que cayó al disco en AC4 se quita al
  // escribir en el bucket; si no, al apagar la bandera (lectura disco primero)
  // taparía la nueva.
  ok("el icono NO está en el disco (la copia vieja se quitó)", !iconoEnDisco);
  const servido = await iconoServido();
  ok("el icono del bucket se sirve", servido.status === 200 && servido.bytes.equals(icono), servido.mime);

  const msg = await imagenEntrante("bucket");
  const entrante = msg?.media?.assetId;
  const entranteEnBucket = entrante ? enBucket(org, entrante) : null;
  ok("la imagen entrante está en el bucket", !!entranteEnBucket);
  ok("la imagen entrante NO está en el disco", !!entrante && !enDisco(org, entrante));
  const medIn = entrante ? await medioServido(entrante) : { status: 0, bytes: Buffer.alloc(0) };
  ok(
    "la imagen entrante del bucket se sirve",
    medIn.status === 200 && !!entranteEnBucket && medIn.bytes.equals(entranteEnBucket)
  );

  // Saliente: el composer de la bandeja (multipart a .../messages/media).
  const conv = await conversacionDelLead();
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
    Buffer.from(`e2e-037-saliente-${randomBytes(6).toString("hex")}`),
    Buffer.from([0xff, 0xd9]),
  ]);
  const caption = `saliente 037 ${randomBytes(3).toString("hex")}`;
  const form = new FormData();
  form.set("file", new Blob([jpeg], { type: "image/jpeg" }), "local.jpg");
  form.set("caption", caption);
  const up = await fetch(`${BASE}/api/conversations/${conv?.id}/messages/media`, {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: form,
  });
  ok("adjunto saliente enviado (201)", up.status === 201, await up.text().catch(() => ""));
  const sal = (await mensajes(conv?.id)).find((m) => m.media?.caption === caption);
  const saliente = sal?.media?.assetId;
  const salienteEnBucket = saliente ? enBucket(org, saliente) : null;
  ok("el adjunto saliente está en el bucket", !!salienteEnBucket && salienteEnBucket.equals(jpeg));
  ok("el adjunto saliente NO está en el disco", !!saliente && !enDisco(org, saliente));
  const medOut = saliente ? await medioServido(saliente) : { status: 0, bytes: Buffer.alloc(0) };
  ok("el adjunto saliente del bucket se sirve", medOut.status === 200 && medOut.bytes.equals(jpeg));

  guardarEstado({
    ...estado,
    bucket: {
      icono: sha(icono),
      entrante,
      entranteSha: entranteEnBucket ? sha(entranteEnBucket) : null,
      saliente,
      salienteSha: sha(jpeg),
    },
  });
}

async function faseVuelta() {
  console.log("== vuelta: bandera apagada con el bucket configurado (AC3) ==");
  const estado = leerEstado();
  if (!estado?.bucket?.saliente) {
    console.error(`Sin estado de la fase bucket en ${ESTADO}: corre antes la fase bucket.`);
    process.exit(1);
  }
  if (process.env.MEDIA_STORE === "bucket" || !BUCKET) {
    console.error("La fase vuelta corre SIN MEDIA_STORE y CON las MEDIA_BUCKET_*.");
    process.exit(1);
  }
  const { org } = estado;
  const h = await salud();
  ok("health: features.media = disco", h.features?.media === "disco", JSON.stringify(h.features));
  ok("health: mediaWritable = true (sondea el disco)", h.mediaWritable === true);

  if (!(await login())) return;

  const icono = await iconoServido();
  ok(
    "el icono escrito en el bucket se sirve",
    icono.status === 200 && sha(icono.bytes) === estado.bucket.icono,
    `servido ${sha(icono.bytes).slice(0, 12)}…`
  );
  const entrante = await medioServido(estado.bucket.entrante);
  ok("la imagen entrante del bucket se sirve", entrante.status === 200 && sha(entrante.bytes) === estado.bucket.entranteSha);
  const saliente = await medioServido(estado.bucket.saliente);
  ok("el adjunto saliente del bucket se sirve", saliente.status === 200 && sha(saliente.bytes) === estado.bucket.salienteSha);
  const viejo = await medioServido(estado.disco.entrante);
  ok("y lo de la fase disco también", viejo.status === 200 && sha(viejo.bytes) === estado.disco.entranteSha);

  // Y al revés: con la bandera apagada, un icono nuevo va al disco y la copia
  // del bucket se borra, para que no lo tape si se vuelve a encender.
  const otro = pngMarcado("vuelta");
  ok("icono subido con la bandera apagada", await subirIcono(otro));
  const otroEnDisco = enDisco(org, "favicon");
  ok("el icono quedó en disco", !!otroEnDisco && otroEnDisco.equals(otro));
  ok("y la copia del bucket se borró", await hasta(async () => !enBucket(org, "favicon"), 10000, 500));
  const servidoOtro = await iconoServido();
  ok("el icono nuevo se sirve", servidoOtro.bytes.equals(otro));
}

async function main() {
  const fases = { disco: faseDisco, bucket: faseBucket, vuelta: faseVuelta };
  const fase = fases[FASE];
  if (!fase) {
    console.error("Uso: node --env-file=… scripts/e2e-almacenamiento.mjs disco|bucket|vuelta");
    process.exit(1);
  }
  try {
    await fase();
  } catch (err) {
    failures++;
    console.log(`  FAIL excepción: ${err instanceof Error ? err.message : err}`);
  }
  console.log(`\n${checks - failures}/${checks} checks OK (fase ${FASE})`);
  process.exit(failures ? 1 : 0);
}

main();
