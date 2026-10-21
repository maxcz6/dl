import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";
import {
  borrarObjeto,
  obtenerObjeto,
  ponerObjeto,
  type ConfigBucket,
} from "@/lib/storage/objetos";

/**
 * 037 — Dónde viven los adjuntos, el logo y el icono: el disco de siempre
 * (`MEDIA_DIR`) o un bucket S3-compatible propio (`MEDIA_STORE=bucket`).
 * Puerto de `lib/storage/medios.ts` de la edición cloud (spec 200).
 *
 * La regla que hace esto seguro: **se escribe donde diga la bandera, pero se
 * lee SIEMPRE en los dos sitios**. La bandera se mueve en las dos direcciones
 * sin dejar nada ilegible y sin migrar los archivos viejos: los nuevos van
 * allá, los viejos siguen donde están.
 *
 * Y una diferencia con cloud (spec 037, D4): si el bucket no acepta la
 * escritura, el archivo se guarda en disco y se avisa en el log. Es un
 * conector opcional (constitución II.3): su fallo no puede perder el adjunto
 * de un cliente. La lectura en los dos sitios lo encuentra después.
 */

/** Solo `[\w.-]+` por segmento: la llave del objeto es la misma ruta relativa. */
function comprobarSegmento(s: string): void {
  if (!/^[\w.-]+$/.test(s)) throw new Error(`segmento de ruta inválido: ${s}`);
}

/** La llave del objeto y, a la vez, la ruta relativa que se guarda en la BD. */
export function llaveDeMedia(organizationId: string, assetId: string): string {
  comprobarSegmento(organizationId);
  comprobarSegmento(assetId);
  return `${organizationId}/${assetId}`;
}

/** Ruta absoluta en el volumen local. */
export function rutaEnDisco(organizationId: string, assetId: string): string {
  comprobarSegmento(organizationId);
  comprobarSegmento(assetId);
  return path.join(getEnv().MEDIA_DIR, organizationId, assetId);
}

/** Por qué el bucket configurado no se puede usar, o `null` si sí. */
export type ProblemaBucket = "incompleto" | "endpoint";

/**
 * La configuración del bucket, o `null` si la instancia no tiene uno usable.
 *
 * Exige las cuatro piezas y un endpoint http(s): media configuración es peor
 * que ninguna, se descubriría con el primer adjunto de un cliente real.
 */
export function configDelBucket(): ConfigBucket | null {
  return leerConfigDelBucket().cfg;
}

export function leerConfigDelBucket(): { cfg: ConfigBucket | null; problema: ProblemaBucket | null } {
  const env = getEnv();
  const { MEDIA_BUCKET_ENDPOINT, MEDIA_BUCKET_NAME, MEDIA_BUCKET_KEY_ID, MEDIA_BUCKET_SECRET } = env;
  if (!MEDIA_BUCKET_ENDPOINT || !MEDIA_BUCKET_NAME || !MEDIA_BUCKET_KEY_ID || !MEDIA_BUCKET_SECRET) {
    const alguna = MEDIA_BUCKET_ENDPOINT || MEDIA_BUCKET_NAME || MEDIA_BUCKET_KEY_ID || MEDIA_BUCKET_SECRET;
    return { cfg: null, problema: alguna || bucketPedido() ? "incompleto" : null };
  }
  let url: URL;
  try {
    url = new URL(MEDIA_BUCKET_ENDPOINT);
  } catch {
    return { cfg: null, problema: "endpoint" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { cfg: null, problema: "endpoint" };
  return {
    cfg: {
      endpoint: MEDIA_BUCKET_ENDPOINT.replace(/\/+$/, ""),
      bucket: MEDIA_BUCKET_NAME,
      accessKeyId: MEDIA_BUCKET_KEY_ID,
      secretAccessKey: MEDIA_BUCKET_SECRET,
      region: env.MEDIA_BUCKET_REGION,
    },
    problema: null,
  };
}

/** La bandera pide el bucket (`MEDIA_STORE=bucket`). */
export function bucketPedido(): boolean {
  return (getEnv().MEDIA_STORE ?? "").trim().toLowerCase() === "bucket";
}

/** Dónde se escribe hoy: el bucket solo si la bandera lo pide Y está configurado. */
export function almacenActivo(): "disco" | "bucket" {
  return bucketPedido() && configDelBucket() ? "bucket" : "disco";
}

let avisoSinConfig = false;

async function escribirEnDisco(organizationId: string, assetId: string, buf: Buffer): Promise<void> {
  const file = rutaEnDisco(organizationId, assetId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
}

/** Guarda el binario y devuelve la ruta relativa que se persiste en la BD. */
export async function guardarMedia(
  organizationId: string,
  assetId: string,
  data: Buffer | Uint8Array,
  contentType?: string
): Promise<string> {
  const llave = llaveDeMedia(organizationId, assetId);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  if (bucketPedido()) {
    const cfg = configDelBucket();
    if (!cfg) {
      // Con la bandera y sin credenciales no se escribe a disco EN SILENCIO:
      // el operador creería que su instancia ya usa el bucket.
      if (!avisoSinConfig) {
        avisoSinConfig = true;
        console.warn("[medios] MEDIA_STORE=bucket pero el bucket no está bien configurado: se escribe en disco");
      }
    } else {
      try {
        await ponerObjeto(cfg, llave, buf, contentType);
        // Ya está en el bucket: se quita la copia vieja del disco, si la hay.
        // Las llaves fijas (el icono) se sobrescriben, y al apagar la bandera
        // se lee primero el disco: una copia vieja ahí taparía la nueva (AC3).
        await rm(rutaEnDisco(organizationId, assetId), { force: true }).catch(() => {});
        return llave;
      } catch (err) {
        // D4: el conector falla, el adjunto no se pierde.
        console.warn(
          `[medios] el bucket no aceptó ${llave} (${err instanceof Error ? err.message.slice(0, 120) : "error"}): se guarda en disco`
        );
      }
    }
  }

  await escribirEnDisco(organizationId, assetId, buf);

  // Lo mismo al revés: con la bandera apagada y el bucket aún configurado, una
  // copia vieja en el bucket taparía esta al volver a encenderla. Sin esperar
  // (el archivo ya está a salvo en disco) y nunca en la degradación de D4,
  // donde el bucket acaba de fallar.
  if (!bucketPedido()) {
    const cfg = configDelBucket();
    if (cfg) void borrarObjeto(cfg, llave).catch(() => {});
  }
  return llave;
}

/**
 * Lee el binario buscando en los DOS sitios, empezando por donde se escribe
 * hoy. Si no está en ninguno, lanza: el llamador ya trata ese caso (404).
 */
export async function leerMedia(organizationId: string, assetId: string): Promise<Buffer> {
  const llave = llaveDeMedia(organizationId, assetId);
  const cfg = configDelBucket();

  if (cfg && almacenActivo() === "bucket") {
    const desdeBucket = await obtenerObjeto(cfg, llave).catch(() => null);
    if (desdeBucket) return desdeBucket;
    return readFile(rutaEnDisco(organizationId, assetId));
  }

  try {
    return await readFile(rutaEnDisco(organizationId, assetId));
  } catch (err) {
    if (!cfg) throw err;
    const desdeBucket = await obtenerObjeto(cfg, llave).catch(() => null);
    if (desdeBucket) return desdeBucket;
    throw err; // el error del disco es el que describe el caso normal
  }
}

/**
 * Borra en los dos sitios. Mejor esfuerzo a propósito: un borrado a medias no
 * puede tumbar la operación que lo pidió (quitar un favicon, olvidar una
 * conversación).
 */
export async function borrarMedia(organizationId: string, assetId: string): Promise<void> {
  const llave = llaveDeMedia(organizationId, assetId);
  await rm(rutaEnDisco(organizationId, assetId), { force: true }).catch(() => {});
  const cfg = configDelBucket();
  if (cfg) {
    await borrarObjeto(cfg, llave).catch((err) => {
      console.warn(`[medios] no se pudo borrar ${llave} del bucket: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`);
    });
  }
}

/** Solo para tests. */
export function resetAvisosDeMedios(): void {
  avisoSinConfig = false;
}
