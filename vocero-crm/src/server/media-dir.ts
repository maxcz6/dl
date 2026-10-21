import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { borrarObjeto, ponerObjeto, type ConfigBucket } from "@/lib/storage/objetos";
import { bucketPedido, leerConfigDelBucket } from "@/lib/storage/medios";

/**
 * 008 / #82 — ¿Se puede escribir en MEDIA_DIR?
 *
 * Es la pregunta que decide si los adjuntos entrantes, el logo y el icono se
 * van a guardar. Se contesta escribiendo DE VERDAD (lo mismo que hará
 * `saveMediaFile`) y borrando el rastro, no mirando permisos.
 *
 * La hacen dos sitios: el arranque (`instrumentation-node.ts`, que avisa en
 * el log) y `/api/health` (que la expone como `mediaWritable`). El
 * healthcheck de Docker pega cada 15 s, y escribir en disco cada vez sería
 * ruido: el resultado se recuerda `MEDIA_DIR_PROBE_TTL_MS`, así que hay como
 * mucho una escritura por minuto, y la del arranque ya deja el primer
 * resultado listo.
 *
 * 037 — Se prueba DONDE SE ESCRIBE: con `MEDIA_STORE=bucket`, un PUT y un
 * DELETE de un objeto de sondeo en el bucket (`dir` es entonces solo el host
 * del endpoint: nunca la llave). Con la bandera y el bucket mal configurado,
 * `writable: false`: los archivos caen al disco, pero quien instala pidió el
 * bucket y tiene que enterarse.
 */

export type MediaDirProbe =
  | { store: "disco" | "bucket"; dir: string; writable: true }
  | { store: "disco" | "bucket"; dir: string; writable: false; code: string };

/** Sondeo real, sin caché: crea el directorio si falta, escribe y borra. */
export async function probeMediaDir(dir: string): Promise<MediaDirProbe> {
  const probe = path.join(dir, `.prueba-escritura-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true }).catch(() => {});
    return { store: "disco", dir, writable: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? String(err);
    return { store: "disco", dir, writable: false, code };
  }
}

/** 037 — Sondeo real del bucket: escribe un objeto vacío y lo borra. */
export async function probeBucket(cfg: ConfigBucket): Promise<MediaDirProbe> {
  const dir = new URL(cfg.endpoint).host;
  const llave = `.sondeo/escritura-${process.pid}`;
  try {
    await ponerObjeto(cfg, llave, Buffer.alloc(0), "application/octet-stream");
    await borrarObjeto(cfg, llave).catch(() => {});
    return { store: "bucket", dir, writable: true };
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    return { store: "bucket", dir, writable: false, code: status ? `bucket_${status}` : "bucket_red" };
  }
}

/** El sondeo de donde se escribe hoy, sin caché. */
export async function probeAlmacen(dir: string): Promise<MediaDirProbe> {
  if (!bucketPedido()) return probeMediaDir(dir);
  const { cfg, problema } = leerConfigDelBucket();
  if (!cfg) return { store: "bucket", dir: "", writable: false, code: `bucket_${problema ?? "incompleto"}` };
  return probeBucket(cfg);
}

/** Cuánto vale un sondeo antes de volver a escribir. */
export const MEDIA_DIR_PROBE_TTL_MS = 60_000;

type ProbeCacheEntry = {
  dir: string;
  expiresAt: number;
  pending: Promise<MediaDirProbe>;
};

// En globalThis, como el cliente de BD y el estado del cerebro externo: los
// módulos pueden evaluarse más de una vez (una por ruta en dev), y el sondeo
// del arranque tiene que servirle a /api/health.
const globalForMedia = globalThis as unknown as {
  __voceroMediaDirProbe?: ProbeCacheEntry;
};

/**
 * El sondeo con caché. Devuelve `null` si el entorno no valida: eso lo
 * reporta, con detalle, el primer `getEnv()` de la app, y aquí no hay
 * directorio que sondear.
 *
 * La caché va por directorio: si `MEDIA_DIR` cambia, se sondea el nuevo
 * aunque el anterior esté fresco.
 */
export async function mediaDirStatus(
  now: number = Date.now()
): Promise<MediaDirProbe | null> {
  let dir: string;
  let clave: string;
  try {
    const env = getEnv();
    dir = path.resolve(env.MEDIA_DIR);
    clave = bucketPedido() ? `bucket:${env.MEDIA_BUCKET_ENDPOINT ?? ""}/${env.MEDIA_BUCKET_NAME ?? ""}` : dir;
  } catch {
    return null;
  }
  const cached = globalForMedia.__voceroMediaDirProbe;
  if (cached && cached.dir === clave && cached.expiresAt > now) {
    return cached.pending;
  }
  const pending = probeAlmacen(dir);
  globalForMedia.__voceroMediaDirProbe = {
    dir: clave,
    expiresAt: now + MEDIA_DIR_PROBE_TTL_MS,
    pending,
  };
  return pending;
}

/** Solo para tests. */
export function resetMediaDirCache(): void {
  delete globalForMedia.__voceroMediaDirProbe;
}
