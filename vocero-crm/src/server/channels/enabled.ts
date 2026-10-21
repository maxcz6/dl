import { getEnv } from "@/lib/env";
import { isChannel, type Channel } from "@/lib/channels";

/**
 * 014 — Qué canales están encendidos en esta instancia.
 *
 * El código de todos los canales viaja siempre en main; lo que decide si
 * existen para el usuario es la variable `CHANNELS`. Una instalación normal
 * (`CHANNELS=whatsapp`, el default) no ve Instagram por ningún lado: ni
 * pantalla, ni webhook, ni variables que llenar.
 *
 * Se hace así, y no con una rama por feature, porque una rama tiene que
 * mantenerse compatible con main Y con las demás ramas opcionales, y su
 * cadena de migraciones diverge sin arreglo posible. Con la bandera hay UNA
 * cadena de migraciones para todo el mundo y los conflictos los resuelve el
 * autor una vez, no cada usuario en cada actualización.
 *
 * La migración se aplica siempre: una columna con default y una tabla vacía
 * son inertes, y a cambio todas las instancias tienen la misma estructura.
 */

/** WhatsApp no se puede apagar: es el canal por el que existe el producto. */
const ALWAYS_ON: Channel = "whatsapp";

export function parseChannels(raw: string | undefined): Set<Channel> {
  const enabled = new Set<Channel>([ALWAYS_ON]);
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    // Cualquier canal del catalogo, no una lista escrita a mano aqui: el
    // canal siguiente solo tiene que existir en lib/channels.ts.
    if (isChannel(name)) enabled.add(name);
  }
  return enabled;
}

export function enabledChannels(): Set<Channel> {
  return parseChannels(getEnv().CHANNELS);
}

export function isChannelEnabled(channel: Channel): boolean {
  return enabledChannels().has(channel);
}

/**
 * Respuesta para una superficie de un canal apagado. 404 y no 403 a
 * propósito: si el canal no está encendido, ese endpoint no existe en esta
 * instancia — no hay nada que revelar sobre él.
 */
export function channelDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
