import { sql } from "drizzle-orm";
import { CHANNEL_ORDER, type Channel } from "@/lib/channels";
import { getDb } from "@/lib/db";
import { APP_VERSION, resolveCommit } from "@/lib/version";
import { parseAgendaFlag } from "@/server/agenda/flag";
import { parseAtribucionFlag } from "@/server/attribution/flag";
import { parseChannels } from "@/server/channels/enabled";
import { mediaDirStatus } from "@/server/media-dir";

/**
 * `GET /api/health` — lo que una plataforma, un script o un `curl` pueden
 * saber de la instancia sin abrir la app ni iniciar sesión.
 *
 * `ok` y el código HTTP dicen UNA cosa: si la base de datos responde. Es lo
 * que mira el healthcheck de Docker para reiniciar el contenedor, y nada de
 * lo demás debe moverlo.
 *
 * La versión viaja aquí a propósito: confirmar un despliegue tiene que poder
 * hacerse desde un pipeline, y es la única forma de comprobar que el build
 * que subió es el que corre. `commitVerified` dice de dónde salió `commit`:
 * `true` si se congeló en el build, `false` si es el `SOURCE_COMMIT` que la
 * plataforma puso en el entorno — que puede estar desfasado (#50). Un
 * pipeline que compare commits tiene que exigir `true`; `commit` sigue ahí
 * igual para no romper a quien ya lo lee.
 *
 * `features` (#82) dice qué banderas de despliegue están encendidas: la
 * forma de confirmar que `AGENDA=on` llegó al contenedor sin abrir Ajustes.
 * Se leen de `process.env` directo, igual que `agendaEnabled()`, y no por
 * `getEnv()`: a esta altura la BD ya respondió (y con ella validó el
 * entorno), pero la pregunta de si una feature existe nunca depende de eso.
 *
 * `mediaWritable` (#82) dice si `MEDIA_DIR` se puede escribir. NO baja `ok`
 * ni el código: el CRM funciona sin adjuntos, y un healthcheck en rojo
 * reiniciaría en bucle un contenedor que atiende clientes. Lo que cambia es
 * que un volumen mal montado se ve desde fuera, y no en un 500 al subir el
 * logo.
 */

export type HealthFeatures = {
  /** Motor de agenda (015): bandera `AGENDA`. */
  agenda: boolean;
  /** Canales encendidos (014/017): bandera `CHANNELS`; `whatsapp` siempre. */
  channels: Channel[];
  /** Atribución de anuncios y CAPI (016): bandera `ATRIBUCION`. */
  atribucion: boolean;
  /** 037 — Dónde pidió quien instala guardar los adjuntos: bandera
   *  `MEDIA_STORE`. Si de verdad se puede escribir ahí lo dice `mediaWritable`. */
  media: "disco" | "bucket";
};

export type HealthOk = {
  ok: true;
  version: string;
  commit?: string;
  commitVerified?: boolean;
  features: HealthFeatures;
  mediaWritable: boolean;
};

export type HealthDown = {
  ok: false;
  error: { code: "db_unavailable"; message: string };
};

export type HealthResult =
  | { status: 200; body: HealthOk }
  | { status: 503; body: HealthDown };

/**
 * Las tres variables de despliegue que deciden qué existe en la instancia.
 * El índice es para que `process.env` encaje sin cast (y el resto se ignora).
 */
export type FlagEnv = {
  AGENDA?: string;
  CHANNELS?: string;
  ATRIBUCION?: string;
  MEDIA_STORE?: string;
  [otra: string]: string | undefined;
};

/**
 * Las banderas, con los mismos parsers que usan las rutas para decidir si una
 * superficie existe: lo que diga aquí es lo que hace la app. Los canales van
 * en el orden del catálogo, no en el de la variable, para que dos instancias
 * iguales respondan igual.
 */
export function healthFeatures(env: FlagEnv = process.env): HealthFeatures {
  const channels = parseChannels(env.CHANNELS);
  return {
    agenda: parseAgendaFlag(env.AGENDA),
    channels: CHANNEL_ORDER.filter((c) => channels.has(c)),
    atribucion: parseAtribucionFlag(env.ATRIBUCION),
    media: env.MEDIA_STORE?.trim().toLowerCase() === "bucket" ? "bucket" : "disco",
  };
}

export async function checkHealth(): Promise<HealthResult> {
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    return {
      status: 503,
      body: {
        ok: false,
        error: { code: "db_unavailable", message: "Base de datos no disponible" },
      },
    };
  }
  const { commit, verified } = resolveCommit();
  const media = await mediaDirStatus();
  return {
    status: 200,
    body: {
      ok: true,
      version: APP_VERSION,
      ...(commit ? { commit, commitVerified: verified } : {}),
      features: healthFeatures(),
      mediaWritable: media?.writable ?? false,
    },
  };
}
