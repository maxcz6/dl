import { CHANNEL_LABEL, type Channel } from "@/lib/channels";

/**
 * 014 — Capacidades declaradas por canal.
 *
 * El núcleo NO debe saber las reglas de WhatsApp: debe preguntarlas. Antes,
 * la ventana de 24 h y el "usa una plantilla aprobada" vivían incrustados en
 * el camino genérico de envío, así que cada canal nuevo tenía que pelearse con
 * suposiciones que no eran suyas — Instagram no tiene plantillas, y su salida
 * fuera de ventana es una etiqueta.
 *
 * Agregar un canal debería ser: escribir su adaptador y declarar aquí lo que
 * puede y no puede hacer.
 */

export type OutsideWindowStrategy =
  /** Solo se puede reabrir con una plantilla aprobada (WhatsApp). */
  | "template"
  /** Se marca el mensaje como respuesta de agente humano (Instagram). */
  | "human_agent_tag"
  /** No hay forma: fuera de ventana no se envía. */
  | "none";

export type ChannelCapabilities = {
  /** Etiqueta legible, para mensajes de error dirigidos al operador. */
  label: string;
  /** Ventana de servicio en ms desde el último entrante; null = sin ventana. */
  windowMs: number | null;
  /** Qué se puede hacer cuando la ventana está cerrada. */
  outsideWindow: OutsideWindowStrategy;
  /**
   * 024 — Hasta cuándo puede contestar una PERSONA con la etiqueta de agente
   * humano, en ms desde el último entrante. null = el canal no tiene esa
   * extensión. La IA nunca la usa: Meta la reserva a personas.
   */
  humanAgentWindowMs: number | null;
  /**
   * 024 — Qué formato de texto dibuja el canal. `plain`: ninguno, así que al
   * texto de la IA se le quitan las marcas antes de enviarlo.
   */
  textFormat: "whatsapp" | "plain";
  /** Límite de texto en BYTES (no caracteres); null = sin límite práctico. */
  maxTextBytes: number | null;
  /**
   * 022 — Límite de texto en CARACTERES, para la plataforma que cuenta así
   * (TikTok). null = no aplica. Un canal declara el que su plataforma mida.
   */
  maxTextChars: number | null;
  /**
   * 022 — Cuántos mensajes admite la plataforma desde el último entrante.
   * null = sin tope. No es un límite de velocidad: no se recupera esperando,
   * solo cuando el cliente vuelve a escribir.
   */
  maxOutboundPerWindow: number | null;
  /** ¿Se pueden mandar adjuntos por este canal hoy? */
  outboundMedia: boolean;
  /**
   * 028 — ¿Admite ubicación y contactos? Son mensajes de WhatsApp: en los
   * demás canales el compositor ni los ofrece.
   */
  structuredMessages: boolean;
  /**
   * ¿El estado del mensaje avanza por webhook (entregado/leído)? Si no, la
   * aceptación de la plataforma es la confirmación y el mensaje nace `sent`
   * — sin esto se queda con el reloj puesto para siempre.
   */
  deliveryReceipts: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapabilities> = {
  whatsapp: {
    label: CHANNEL_LABEL.whatsapp,
    windowMs: DAY_MS,
    outsideWindow: "template",
    humanAgentWindowMs: null,
    textFormat: "whatsapp",
    maxTextBytes: null,
    // 022: el límite de Meta para un texto. Antes vivía como un tope global en
    // el esquema de la API, igual para todos los canales; ahora que un canal
    // admite más (TikTok, 6,000), cada uno declara el suyo.
    maxTextChars: 4096,
    maxOutboundPerWindow: null,
    outboundMedia: true,
    structuredMessages: true,
    deliveryReceipts: true,
  },
  instagram: {
    label: CHANNEL_LABEL.instagram,
    windowMs: DAY_MS,
    outsideWindow: "human_agent_tag",
    humanAgentWindowMs: 7 * DAY_MS,
    textFormat: "plain",
    // Meta corta en 1000 bytes: con acentos y emojis el margen real es menor
    // de lo que aparenta al contar caracteres.
    maxTextBytes: 1000,
    maxTextChars: null,
    maxOutboundPerWindow: null,
    outboundMedia: false,
    structuredMessages: false,
    deliveryReceipts: false,
  },
  // 017: Messenger comparte la plataforma de mensajería de Meta con Instagram
  // (misma ventana de 24 h, misma etiqueta HUMAN_AGENT fuera de ella, sin
  // plantillas), pero admite textos más largos: 2000 caracteres. Se declara
  // en bytes para no ser más generoso que la plataforma con acentos y emojis.
  messenger: {
    label: CHANNEL_LABEL.messenger,
    windowMs: DAY_MS,
    outsideWindow: "human_agent_tag",
    humanAgentWindowMs: 7 * DAY_MS,
    textFormat: "plain",
    maxTextBytes: 2000,
    maxTextChars: null,
    maxOutboundPerWindow: null,
    outboundMedia: false,
    structuredMessages: false,
    deliveryReceipts: false,
  },
  /**
   * 022: lo que TikTok impone a los mensajes directos de una cuenta de
   * negocio. Tras el último mensaje del cliente acepta hasta 10 mensajes en 48
   * horas y no hay plantilla ni etiqueta que reabra: fuera de eso el envío
   * falla. El texto se mide en caracteres (6,000). Admite una imagen, pero el
   * envío de adjuntos queda fuera de esta entrega (spec 022 · D9).
   */
  tiktok: {
    label: CHANNEL_LABEL.tiktok,
    windowMs: 2 * DAY_MS,
    outsideWindow: "none",
    humanAgentWindowMs: null,
    textFormat: "plain",
    maxTextBytes: null,
    maxTextChars: 6000,
    maxOutboundPerWindow: 10,
    outboundMedia: false,
    structuredMessages: false,
    deliveryReceipts: false,
  },
};

/**
 * 022 — La ventana de servicio de un canal, en ms. Con `null` (un canal sin
 * ventana) se devuelve Infinity: nunca se cierra.
 */
export function windowMsFor(channel: Channel): number {
  return capabilitiesFor(channel).windowMs ?? Number.POSITIVE_INFINITY;
}

export function capabilitiesFor(channel: Channel): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel] ?? CHANNEL_CAPABILITIES.whatsapp;
}

/** Mensaje para el operador cuando la ventana está cerrada, según el canal. */
export function windowClosedMessage(channel: Channel): string {
  const caps = capabilitiesFor(channel);
  switch (caps.outsideWindow) {
    case "template":
      return "La ventana de 24 horas está cerrada; usa una plantilla aprobada";
    case "human_agent_tag":
      // 024: dentro de la extensión el envío sale etiquetado solo y no se le
      // pide nada al operador; este mensaje es para cuando también venció.
      return `La ventana de atención de ${caps.label} está cerrada: solo se puede contestar hasta ${dias(caps.humanAgentWindowMs)} después del último mensaje del cliente. Hay que esperar a que vuelva a escribir`;
    case "none":
      return `La ventana de ${caps.label} está cerrada y este canal no permite reabrirla: hay que esperar a que el cliente vuelva a escribir`;
  }
}

/**
 * 024 — Mensaje cuando quien intenta escribir es la IA y la ventana normal ya
 * cerró, aunque una persona todavía pueda contestar.
 */
export function aiWindowClosedMessage(channel: Channel): string {
  const caps = capabilitiesFor(channel);
  return `La ventana de respuestas automáticas de ${caps.label} está cerrada: pasadas ${horas(caps.windowMs)} del último mensaje del cliente solo puede contestar una persona`;
}

const horas = (ms: number | null) => `${Math.round((ms ?? 0) / (60 * 60 * 1000))} horas`;
const dias = (ms: number | null) => `${Math.round((ms ?? 0) / DAY_MS)} días`;

/**
 * El texto más largo que acepta la API del CRM, sea cual sea el canal: el
 * mayor de los que declaran límite en caracteres. Es solo la primera barrera
 * (un body absurdo no llega a la base); el límite de cada canal lo comprueba
 * el envío, que es quien sabe a qué canal va.
 */
export const MAX_TEXT_CHARS_ANY_CHANNEL = Math.max(
  ...Object.values(CHANNEL_CAPABILITIES).map((c) => c.maxTextChars ?? 0)
);

/** Lo que se le dice a quien manda un texto más largo que eso. */
export const TEXT_TOO_LONG_ANY_CHANNEL = `El mensaje es demasiado largo: el máximo es ${MAX_TEXT_CHARS_ANY_CHANNEL.toLocaleString("es-MX")} caracteres`;

/** ¿Este texto cabe en el canal? Mira el límite que su plataforma mida. */
export function textFits(channel: Channel, text: string): boolean {
  const caps = capabilitiesFor(channel);
  if (caps.maxTextBytes !== null && Buffer.byteLength(text, "utf8") > caps.maxTextBytes) {
    return false;
  }
  // Caracteres como los cuenta una persona (puntos de código), no unidades
  // UTF-16: un emoji es uno.
  if (caps.maxTextChars !== null && [...text].length > caps.maxTextChars) {
    return false;
  }
  return true;
}

/** El límite de texto del canal, dicho para el operador. */
export function textLimitMessage(channel: Channel): string {
  const caps = capabilitiesFor(channel);
  const limite =
    caps.maxTextChars !== null
      ? `${caps.maxTextChars.toLocaleString("es-MX")} caracteres`
      : `${caps.maxTextBytes} bytes`;
  return `${caps.label} no acepta mensajes de más de ${limite}: acorta el texto`;
}

/** Mensaje para el operador cuando el canal ya no admite más mensajes. */
export function outboundLimitMessage(channel: Channel): string {
  const caps = capabilitiesFor(channel);
  return `${caps.label} solo permite ${caps.maxOutboundPerWindow} mensajes después del último mensaje del cliente: hay que esperar a que vuelva a escribir`;
}
