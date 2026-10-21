import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La versión que enseña la app tiene que ser la del código que corre. Si se
 * desincroniza, es peor que no tenerla: alguien va a depurar media hora un bug
 * ya arreglado porque la etiqueta le dijo que el build sí había llegado.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const pkg = JSON.parse(
  readFileSync(path.join(RAIZ, "package.json"), "utf8")
) as { version: string };

describe("versión de la app", () => {
  it("package.json lleva un SemVer válido", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no la duplica nadie: sale de package.json vía next.config", () => {
    const config = readFileSync(path.join(RAIZ, "next.config.ts"), "utf8");
    expect(config).toContain("package.json");
    expect(config).toContain("NEXT_PUBLIC_APP_VERSION");
    // Una versión escrita a mano en el config es exactamente cómo se
    // desincroniza; si aparece un literal tipo "1.2.3", esto se pone rojo.
    expect(config).not.toMatch(/["']\d+\.\d+\.\d+["']/);
  });

  it("la insignia no cablea el nombre del producto", () => {
    // Esto es white-label: una instancia rebautizada que dice "Vocero" en el
    // tooltip delata el producto de debajo justo donde el operador la mira
    // todos los días.
    const nav = readFileSync(
      path.join(RAIZ, "src", "components", "app-nav.tsx"),
      "utf8"
    );
    // Se busca la llamada real. Antes buscaba `versionLabel()`, que no existe
    // en el componente (se llama con el commit): el índice era -1 y la prueba
    // miraba, por casualidad, el final del archivo.
    const llamada = nav.indexOf("versionLabel(version.commit)");
    expect(llamada).toBeGreaterThan(0);
    const insignia = nav.slice(llamada - 600, llamada + 300);
    expect(insignia).toContain("branding.name");
    expect(insignia).not.toMatch(/`Vocero \$\{/);
  });

  it("docker compose arranca por defecto la imagen de esta misma versión", () => {
    // El compose es el único otro lugar con la versión escrita: fija la imagen
    // publicada. Si package.json sube y el compose no, `docker compose up -d`
    // corre la versión anterior mientras el código y el CHANGELOG hablan de
    // la nueva.
    const compose = readFileSync(path.join(RAIZ, "docker-compose.yml"), "utf8");
    const imagen = compose.match(/image:\s*\S+:\$\{VOCERO_CRM_VERSION:-([^}\s]+)\}/);
    expect(imagen?.[1]).toBe(pkg.version);
  });

  it("el Dockerfile acepta el commit sin exigirlo", () => {
    const dockerfile = readFileSync(path.join(RAIZ, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("ARG SOURCE_COMMIT");
    // Con default vacío: quien construya sin pasarlo no debe ver un build roto.
    expect(dockerfile).toMatch(/ARG SOURCE_COMMIT=""/);
  });
});

describe("versionLabel", () => {
  it("resuelve el commit de la plataforma cuando el build no lo trajo… SIN verificar", async () => {
    // Hay plataformas que publican `SOURCE_COMMIT` en el contenedor sin
    // pasarlo al build. Sin este respaldo la insignia enseña solo la versión,
    // que no se mueve entre despliegues del mismo release. Pero ese commit es
    // la palabra de la plataforma: si nadie lo actualiza, miente (#50).
    process.env.NEXT_PUBLIC_APP_VERSION = "1.4.2";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "";
    process.env.SOURCE_COMMIT = "abcdef1234567890";
    const m = await import(`@/lib/version?plat=${Date.now()}`);
    expect(m.resolveCommit()).toEqual({ commit: "abcdef1", verified: false });
    expect(m.versionLabel(m.resolveCommit().commit)).toBe("v1.4.2 · abcdef1");
  });

  it("el del build MANDA sobre el de la plataforma, y es el único verificado", async () => {
    // Si los dos existen, el congelado en la imagen es el que de verdad
    // corresponde al código que corre.
    process.env.NEXT_PUBLIC_APP_VERSION = "1.4.2";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "1111111aaaa";
    process.env.SOURCE_COMMIT = "2222222bbbb";
    const m = await import(`@/lib/version?both=${Date.now()}`);
    expect(m.resolveCommit()).toEqual({ commit: "1111111", verified: true });
  });

  it("sin ninguno de los dos, solo la versión", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "1.4.2";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "";
    delete process.env.SOURCE_COMMIT;
    const m = await import(`@/lib/version?none=${Date.now()}`);
    expect(m.resolveCommit()).toEqual({ commit: "", verified: false });
    expect(m.versionLabel(m.resolveCommit().commit)).toBe("v1.4.2");
  });

  it("con commit muestra los dos; sin commit, solo la versión", async () => {
    // El módulo lee `process.env` al importarse, así que cada caso necesita su
    // propio import fresco.
    process.env.NEXT_PUBLIC_APP_VERSION = "1.4.2";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "8e62d0bdfe5a7fb";
    const conCommit = await import(`@/lib/version?con=${Date.now()}`);
    expect(conCommit.versionLabel()).toBe("v1.4.2 · 8e62d0b");

    process.env.NEXT_PUBLIC_BUILD_COMMIT = "";
    const sinCommit = await import(`@/lib/version?sin=${Date.now()}`);
    expect(sinCommit.versionLabel()).toBe("v1.4.2");
  });
});

/**
 * #50, punto 4 — La insignia puede mentir en silencio.
 *
 * Una instancia mostraba `v1.3.0 · 52c5034` y corría `73e93c1`, 14 commits
 * por delante: el `SOURCE_COMMIT` estaba escrito a mano en la plataforma y
 * nadie lo actualizaba, y el respaldo de ejecución lo presentaba igual que uno
 * congelado en el build. Ahora dice lo que es.
 */
describe("un commit que no salió del build se presenta como NO verificado", () => {
  const ENV_ORIGINAL = { ...process.env };
  // El módulo lee `process.env` al importarse: cada caso, un import fresco.
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    vi.resetModules();
  });

  it("el tooltip lo dice, con de dónde salió y cómo verificarlo", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "1.3.0";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "";
    process.env.SOURCE_COMMIT = "52c5034aaaa";
    const m = await import("@/lib/version");
    const titulo = m.versionTitle("Clínica Sur", m.resolveCommit());
    expect(titulo).toContain("52c5034");
    expect(titulo).toContain("no viene del build");
    expect(titulo).toContain("build arg SOURCE_COMMIT");
    // White-label también aquí: el nombre es el de la marca.
    expect(titulo.startsWith("Clínica Sur 1.3.0")).toBe(true);
    expect(titulo).not.toContain("Vocero");
  });

  it("el verificado no lleva advertencia; sin commit, solo nombre y versión", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "1.3.0";
    process.env.NEXT_PUBLIC_BUILD_COMMIT = "73e93c1bbbb";
    const m = await import("@/lib/version");
    expect(m.versionTitle("Clínica Sur", m.resolveCommit())).toBe(
      "Clínica Sur 1.3.0, construido del commit 73e93c1"
    );
    expect(m.versionTitle("Clínica Sur", { commit: "", verified: false })).toBe(
      "Clínica Sur 1.3.0"
    );
  });

  it("la insignia pinta la advertencia SOLO para un commit sin verificar", () => {
    const nav = readFileSync(
      path.join(RAIZ, "src", "components", "app-nav.tsx"),
      "utf8"
    );
    expect(nav).toMatch(
      /\{version\.commit && !version\.verified && \([\s\S]{0,400}UNVERIFIED_COMMIT_NOTE/
    );
  });

  describe("/api/health", () => {
    // Aquí solo importa el commit: la forma completa (con `features` y
    // `mediaWritable`, #82) se prueba en tests/unit/health.test.ts.
    // Cada caso re-importa la ruta con `resetModules` (lee el entorno al
    // importarse): en una corrida cargada eso puede pasar de los 5 s de
    // serie, y una prueba que expira sigue corriendo detrás de la siguiente.
    const IMPORT_FRESCO_MS = 30_000;

    async function salud(env: Record<string, string | undefined>) {
      vi.resetModules();
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.doMock("@/lib/db", () => ({
        getDb: () => ({ execute: async () => [] }),
      }));
      const { GET } = await import("@/app/api/health/route");
      return (await GET()).json();
    }

    it("commit del build → commitVerified: true", async () => {
      expect(
        await salud({
          NEXT_PUBLIC_APP_VERSION: "1.3.0",
          NEXT_PUBLIC_BUILD_COMMIT: "73e93c1bbbb",
          SOURCE_COMMIT: "52c5034aaaa",
        })
      ).toMatchObject({ ok: true, version: "1.3.0", commit: "73e93c1", commitVerified: true });
    }, IMPORT_FRESCO_MS);

    it("commit solo del entorno → sale, pero con commitVerified: false", async () => {
      // `commit` se conserva: hay scripts que ya lo leen y no se les rompe.
      expect(
        await salud({
          NEXT_PUBLIC_APP_VERSION: "1.3.0",
          NEXT_PUBLIC_BUILD_COMMIT: "",
          SOURCE_COMMIT: "52c5034aaaa",
        })
      ).toMatchObject({ ok: true, version: "1.3.0", commit: "52c5034", commitVerified: false });
    }, IMPORT_FRESCO_MS);

    it("sin commit por ningún lado → solo la versión, sin afirmar nada", async () => {
      const cuerpo = await salud({
        NEXT_PUBLIC_APP_VERSION: "1.3.0",
        NEXT_PUBLIC_BUILD_COMMIT: "",
        SOURCE_COMMIT: undefined,
      });
      expect(cuerpo).toMatchObject({ ok: true, version: "1.3.0" });
      expect(cuerpo).not.toHaveProperty("commit");
      expect(cuerpo).not.toHaveProperty("commitVerified");
    }, IMPORT_FRESCO_MS);
  });
});
