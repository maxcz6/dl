/**
 * Self-test E2E — 034: roles como datos.
 *
 * Conduce la app real: enciende y apaga herramientas desde la API de la
 * pantalla Agente, comprueba lo que ve un cerebro en `GET /api/bot/profile`,
 * carga el preset del Calificador y mira que el Laboratorio corra las personas
 * del rol.
 *
 * Uso: app corriendo (`next dev`) con BOT_API_KEY y AGENDA=on;
 *   node --env-file=.env scripts/e2e-roles.mjs
 * Sale con código 1 si algún check falla.
 */
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";

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

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
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

const bot = (path) => api(path, { headers: { "x-api-key": BOT_KEY } });
const TODAS = ["ficha", "etapa", "agendar", "reprogramar", "salida", "escalar"];

async function main() {
  if (!BOT_KEY) {
    console.error("Falta BOT_API_KEY en el entorno.");
    process.exit(2);
  }
  console.log("== Setup ==");
  const email = "e2e-roles@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador Roles" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));
  // Partir de lo que tiene una instalación que actualiza: todas encendidas.
  await api("/api/agent/profile/preset", { method: "POST", body: JSON.stringify({ role: "calificador" }) });

  console.log("\n== AC2: sin tocar nada, todas ==");
  let p = (await api("/api/agent/profile")).json;
  ok("la pantalla ve el rol Calificador", p?.profile?.role === "calificador", JSON.stringify(p?.profile?.role));
  ok("con todas las herramientas", JSON.stringify(p?.profile?.tools) === JSON.stringify(TODAS), JSON.stringify(p?.profile?.tools));
  ok("y sabe que hay agenda (AGENDA=on)", p?.agendaEnabled === true, String(p?.agendaEnabled));
  let b = (await bot("/api/bot/profile")).json;
  ok("el cerebro ve role y tools", b?.profile?.role === "calificador" && JSON.stringify(b?.profile?.tools) === JSON.stringify(TODAS), JSON.stringify(b?.profile));

  console.log("\n== AC1: apagar agendar y reprogramar ==");
  const put = await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ tools: ["ficha", "salida"] }),
  });
  ok("se guarda", put.res.ok, `${put.res.status} ${JSON.stringify(put.json)}`);
  b = (await bot("/api/bot/profile")).json;
  ok(
    "el cerebro ve solo las encendidas, con escalar siempre",
    JSON.stringify(b?.profile?.tools) === JSON.stringify(["ficha", "salida", "escalar"]),
    JSON.stringify(b?.profile?.tools)
  );
  const mala = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ tools: ["volar"] }) });
  ok("una clave fuera del catálogo es 422", mala.res.status === 422, String(mala.res.status));
  const sinEscalar = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ tools: [] }) });
  b = (await bot("/api/bot/profile")).json;
  ok(
    "apagar todo deja escalar",
    sinEscalar.res.ok && JSON.stringify(b?.profile?.tools) === JSON.stringify(["escalar"]),
    JSON.stringify(b?.profile?.tools)
  );
  const nombre = await api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ name: "Sofi" }) });
  b = (await bot("/api/bot/profile")).json;
  ok(
    "guardar otro campo no toca las herramientas",
    nombre.res.ok && JSON.stringify(b?.profile?.tools) === JSON.stringify(["escalar"]),
    JSON.stringify(b?.profile?.tools)
  );

  console.log("\n== AC3: el preset del Calificador ==");
  await api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ instructions: "instrucciones viejas", escalationRules: "reglas viejas" }),
  });
  const preset = await api("/api/agent/profile/preset", { method: "POST", body: JSON.stringify({ role: "calificador" }) });
  ok("se carga", preset.res.ok, JSON.stringify(preset.json));
  p = (await api("/api/agent/profile")).json;
  ok(
    "reemplaza instrucciones y reglas de escalado",
    p?.profile?.instructions?.includes("Calificarla") && !p?.profile?.instructions?.includes("viejas") &&
      p?.profile?.escalationRules && !p.profile.escalationRules.includes("viejas"),
    JSON.stringify({ i: p?.profile?.instructions?.slice(0, 60), r: p?.profile?.escalationRules?.slice(0, 60) })
  );
  ok("y enciende todas sus herramientas", JSON.stringify(p?.profile?.tools) === JSON.stringify(TODAS), JSON.stringify(p?.profile?.tools));
  ok("conserva el nombre del agente", p?.profile?.name === "Sofi", p?.profile?.name);
  const rolMalo = await api("/api/agent/profile/preset", { method: "POST", body: JSON.stringify({ role: "vendedor" }) });
  ok("un rol que no existe es 422", rolMalo.res.status === 422, String(rolMalo.res.status));

  console.log(`\n${checks - failures}/${checks} checks en verde`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
