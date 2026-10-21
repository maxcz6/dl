import { deflateSync } from "node:zlib";

/**
 * 018 — PNG real y pequeño para el wa-mock.
 *
 * La copia del creativo solo acepta imágenes de verdad por su `content-type`,
 * y la tarjeta de la bandeja se revisa en un navegador: con bytes de mentira se
 * vería un ícono roto y no se podría distinguir un anuncio de otro. El color
 * sale de la semilla, así que dos anuncios de prueba se ven distintos.
 */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (TABLA_CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

export function pngDePrueba(semilla: string, lado = 96): Buffer {
  let h = 2166136261;
  for (const ch of semilla) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const base = [h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff];

  const ancho = lado * 3 + 1;
  const pixeles = Buffer.alloc(ancho * lado);
  for (let y = 0; y < lado; y++) {
    const fila = y * ancho;
    pixeles[fila] = 0; // sin filtro
    for (let x = 0; x < lado; x++) {
      const i = fila + 1 + x * 3;
      // Degradado hacia el azul de la marca y un rectángulo claro al centro:
      // parece un creativo, no un bloque plano.
      const t = (x + y) / (2 * lado);
      const centro = x > lado * 0.2 && x < lado * 0.8 && y > lado * 0.38 && y < lado * 0.62;
      const marca = [13, 91, 255];
      for (let canal = 0; canal < 3; canal++) {
        pixeles[i + canal] = centro
          ? 245
          : Math.round((base[canal] ?? 0) * (1 - t) + (marca[canal] ?? 0) * t);
      }
    }
  }

  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera[8] = 8; // bits por canal
  cabecera[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloque("IHDR", cabecera),
    bloque("IDAT", deflateSync(pixeles)),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}
