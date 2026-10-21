/**
 * Qué versión está corriendo.
 *
 * Existe para responder una pregunta que hoy no tiene respuesta desde la app:
 * "¿ya se desplegó mi cambio?". Sin esto hay que ir al servidor a comparar
 * commits, y en la práctica nadie lo hace — se asume que sí, y se depura
 * durante media hora un bug que ya estaba arreglado en un build que nunca
 * llegó.
 *
 * Lo que se congela al CONSTRUIR (ver `next.config.ts`) va dentro del binario
 * y no cambia en tiempo de ejecución: la versión de `package.json` siempre, y
 * el commit SOLO si llegó al build (build arg `SOURCE_COMMIT`).
 *
 * Si no llegó, el servidor enseña el `SOURCE_COMMIT` que encuentre en el
 * entorno al arrancar — pero ese es la palabra de la plataforma, no del
 * código, y puede estar desfasado: una variable escrita a mano una vez se
 * queda quieta mientras la app se sigue actualizando debajo (#50). Por eso
 * viaja marcado como NO verificado, en la insignia y en `/api/health`, en vez
 * de presentarse como si saliera del build.
 */

/** SemVer de `package.json`. Cambia cuando alguien publica, no en cada push. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/**
 * Commit del que salió el build, corto. Vacío si quien construyó no lo pasó
 * como build arg (`--build-arg SOURCE_COMMIT=...`).
 *
 * Es el que de verdad zanja la duda: dos despliegues seguidos de `main` sin
 * tocar la versión se ven idénticos por SemVer y distintos por commit.
 */
export const BUILD_COMMIT = (process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "").slice(0, 7);

export type ResolvedCommit = {
  /** Commit corto; vacío si no hay ninguno por ningún lado. */
  commit: string;
  /**
   * `true` SOLO si salió del build. El que anuncia la plataforma en tiempo de
   * ejecución no lo es: el binario no tiene cómo comprobar que ese commit sea
   * el de su propio código.
   */
  verified: boolean;
};

/**
 * Commit resuelto EN EL SERVIDOR, con su procedencia.
 *
 * Primero el que se congeló al construir. Si quien construyó no lo pasó, el
 * `SOURCE_COMMIT` del entorno: hay plataformas que lo publican en el
 * contenedor sin pasarlo al build, y sin este respaldo la insignia enseñaría
 * solo la versión — que no se mueve entre despliegues del mismo release. Pero
 * ese respaldo sale como NO verificado: si la plataforma no lo actualiza en
 * cada despliegue, dice un commit que no es (#50).
 *
 * Solo tiene sentido llamarla desde el servidor: en el cliente, `process.env`
 * únicamente lleva las variables `NEXT_PUBLIC_`.
 */
export function resolveCommit(): ResolvedCommit {
  if (BUILD_COMMIT) return { commit: BUILD_COMMIT, verified: true };
  return {
    commit: (process.env.SOURCE_COMMIT ?? "").trim().slice(0, 7),
    verified: false,
  };
}

/**
 * `v1.1.0 · 8e62d0b`, o solo `v1.1.0` si no hay commit por ningún lado.
 * El `commit` se pasa cuando lo resolvió el servidor.
 */
export function versionLabel(commit: string = BUILD_COMMIT): string {
  return commit ? `v${APP_VERSION} · ${commit}` : `v${APP_VERSION}`;
}

/** Lo que acompaña, en la insignia, a un commit que no salió del build. */
export const UNVERIFIED_COMMIT_NOTE = "commit sin verificar";

/**
 * El tooltip de la insignia. El nombre llega de la marca y no de una
 * constante: esto es white-label, y una instancia rebautizada que dice
 * "Vocero" aquí delata el producto de debajo.
 *
 * Con un commit sin verificar dice de dónde salió y cómo arreglarlo: quien lo
 * lee está justo dudando de qué código corre.
 */
export function versionTitle(name: string, resolved: ResolvedCommit): string {
  if (!resolved.commit) return `${name} ${APP_VERSION}`;
  if (resolved.verified) {
    return `${name} ${APP_VERSION}, construido del commit ${resolved.commit}`;
  }
  return (
    `${name} ${APP_VERSION}. El commit ${resolved.commit} no viene del build: ` +
    "lo anunció la plataforma al arrancar y puede no ser el del código que " +
    "corre. Para verificarlo, pásalo como build arg SOURCE_COMMIT en cada despliegue."
  );
}
