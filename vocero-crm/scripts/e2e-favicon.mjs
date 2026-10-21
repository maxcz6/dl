/**
 * Self-test E2E de comportamiento — icono de la pestaña y logo de la barra
 * (guion tests/e2e/us-diseno-atlas.md, secciones "icono" y "logo").
 *
 * Dos cosas se prueban aquí sobre todo: que TODA instancia tenga icono sin
 * configurar nada, y que no se pueda colar un documento haciéndolo pasar por
 * imagen — esto se sirve desde el mismo dominio que la app. Y una tercera:
 * que el logo que sube el dueño se vea donde se ve la marca (barra lateral,
 * login), no solo en la pestaña.
 *
 * Uso: node --env-file=.env scripts/e2e-favicon.mjs
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

let cookie = "";
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

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}

const json = (path, opts = {}) =>
  api(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });

/**
 * El HTML que pinta el servidor. La marca viaja en SSR (sin parpadeo), así
 * que lo que dibujan la barra lateral y el login ya está en la respuesta.
 */
const paginaDe = async (path, { sesion = true } = {}) =>
  (sesion ? await api(path) : await fetch(`${BASE}${path}`)).text();

/**
 * El mosaico de la marca dibujando un archivo: `<img src=…>`. La pestaña usa
 * la misma URL pero en `<link href=…>`, así que no cuenta aquí.
 */
const LOGO_EN_MOSAICO = /<img[^>]*src="\/api\/branding\/favicon\?v=([^"&]+)"/;
const versionEnMosaico = (html) => LOGO_EN_MOSAICO.exec(html)?.[1] ?? null;

/** PNG de 1×1 real: sirve para probar el camino feliz de la carga. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

console.log("== Setup ==");
const email = "e2e@vocero.test";
const password = "password-e2e-123";
let su = await json("/api/auth/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email, password, name: "Operador E2E" }),
});
if (!su.ok) {
  su = await json("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
ok("registro o login del propietario", su.ok);

// Se parte de una marca conocida.
await json("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({ name: "Acme", accent: "#3f6b66", currency: "MXN" }),
});

console.log("\n== Sin configurar nada, ya hay icono ==");
let res = await api("/api/branding/favicon");
let cuerpo = await res.text();
ok("la ruta pública responde 200", res.status === 200);
ok(
  "es un SVG dibujado con la marca",
  res.headers.get("content-type")?.includes("svg") &&
    cuerpo.includes(">A<") &&
    cuerpo.includes("#3f6b66"),
  cuerpo.slice(0, 80)
);
ok(
  "y se sirve sin permitir que ejecute nada",
  res.headers.get("content-security-policy")?.includes("default-src 'none'") &&
    res.headers.get("x-content-type-options") === "nosniff"
);

// Sin sesión: el login también tiene pestaña.
const sinSesion = await fetch(`${BASE}/api/branding/favicon`);
ok("se sirve sin sesión", sinSesion.status === 200);

console.log("\n== El dueño sube su logo ==");
const subida = await api("/api/settings/branding/favicon", {
  method: "PUT",
  headers: { "content-type": "image/png" },
  body: PNG_1X1,
});
const subidaJson = await subida.json().catch(() => null);
ok("PUT con un PNG real → 200", subida.ok, JSON.stringify(subidaJson));
ok(
  "queda registrado con su tipo y una versión",
  subidaJson?.favicon?.mime === "image/png" &&
    Number.isFinite(subidaJson?.favicon?.version) &&
    subidaJson.favicon.version > 0,
  JSON.stringify(subidaJson)
);

res = await api("/api/branding/favicon");
const buf = Buffer.from(await res.arrayBuffer());
ok(
  "ahora la ruta sirve el PNG subido, byte por byte",
  res.headers.get("content-type") === "image/png" && buf.equals(PNG_1X1),
  `${res.headers.get("content-type")} ${buf.length}B`
);

console.log("\n== El logo subido se ve también donde se ve la marca ==");
// Antes solo cambiaba la pestaña: la barra lateral y el login seguían con la
// inicial, y quien subía su logo no lo veía por ningún lado.
const v1 = `u${subidaJson?.favicon?.version}`;
let pagina = await paginaDe("/inbox");
ok(
  "la barra lateral lo dibuja, con la MISMA URL versionada que la pestaña",
  versionEnMosaico(pagina) === v1,
  `mosaico con ${versionEnMosaico(pagina) ?? "la inicial"}, esperado ${v1}`
);
pagina = await paginaDe("/login", { sesion: false });
ok(
  "el login también, sin sesión",
  versionEnMosaico(pagina) === v1,
  `mosaico con ${versionEnMosaico(pagina) ?? "la inicial"}, esperado ${v1}`
);

console.log("\n== No se cuela un documento disfrazado de imagen ==");
const htmlComoPng = await api("/api/settings/branding/favicon", {
  method: "PUT",
  headers: { "content-type": "image/png" }, // MIENTE
  body: Buffer.from("<html><script>alert(1)</script></html>", "utf8"),
});
ok(
  "declarar image/png y mandar HTML → 422",
  htmlComoPng.status === 422,
  String(htmlComoPng.status)
);

res = await api("/api/branding/favicon");
const trasIntento = Buffer.from(await res.arrayBuffer());
ok("y el icono bueno sigue intacto", trasIntento.equals(PNG_1X1));

const gigante = await api("/api/settings/branding/favicon", {
  method: "PUT",
  headers: { "content-type": "image/png" },
  body: Buffer.alloc(300 * 1024, 1),
});
ok("un archivo de 300 KB → 413", gigante.status === 413, String(gigante.status));

const vacio = await api("/api/settings/branding/favicon", {
  method: "PUT",
  headers: { "content-type": "image/png" },
  body: Buffer.alloc(0),
});
ok("un cuerpo vacío → 422", vacio.status === 422, String(vacio.status));

console.log("\n== Guardar la marca NO borra el logo ==");
await json("/api/settings/branding", {
  method: "PUT",
  body: JSON.stringify({ name: "Acme Dos", accent: "#3f6b66", currency: "MXN" }),
});
res = await api("/api/branding/favicon");
ok(
  "cambiar el nombre deja el logo donde estaba",
  Buffer.from(await res.arrayBuffer()).equals(PNG_1X1)
);

console.log("\n== Se puede volver al generado ==");
const quitado = await api("/api/settings/branding/favicon", { method: "DELETE" });
ok("DELETE → 200", quitado.ok);
res = await api("/api/branding/favicon");
cuerpo = await res.text();
ok(
  "vuelve el generado, ahora con la inicial nueva",
  res.headers.get("content-type")?.includes("svg") && cuerpo.includes(">A<"),
  cuerpo.slice(0, 60)
);
pagina = await paginaDe("/inbox");
ok(
  "y la barra lateral vuelve a la inicial, sin imagen rota",
  versionEnMosaico(pagina) === null &&
    /class="brand-tile[^"]*"[^>]*><span[^>]*>A<\/span>/.test(pagina),
  versionEnMosaico(pagina) ?? "sin la inicial en el mosaico"
);

console.log("\n== Quitar y volver a subir NO repite la URL ==");
// El caso que importa: si la versión reiniciara, `?v=u1` sería la misma URL
// que la del logo anterior y el navegador seguiría enseñando el viejo.
await new Promise((r) => setTimeout(r, 5));
const otra = await api("/api/settings/branding/favicon", {
  method: "PUT",
  headers: { "content-type": "image/png" },
  body: PNG_1X1,
});
const otraJson = await otra.json();
ok(
  "la versión avanza en vez de reiniciar",
  otraJson?.favicon?.version > subidaJson?.favicon?.version,
  `${subidaJson?.favicon?.version} → ${otraJson?.favicon?.version}`
);

// Y la marca que sirve el layout cambia de verdad.
const marca = await (await json("/api/settings/branding")).json();
ok(
  "la marca expone el icono nuevo",
  marca?.branding?.favicon?.version === otraJson.favicon.version,
  JSON.stringify(marca?.branding?.favicon)
);
pagina = await paginaDe("/inbox");
ok(
  "y la barra lateral pide el logo nuevo, no el que el navegador ya guardó",
  versionEnMosaico(pagina) === `u${otraJson?.favicon?.version}`,
  `mosaico con ${versionEnMosaico(pagina) ?? "la inicial"}`
);

console.log(
  failures === 0
    ? `\nTODO VERDE — ${checks}/${checks} checks`
    : `\n${checks - failures}/${checks} checks — ${failures} FALLARON`
);
process.exit(failures === 0 ? 0 : 1);
