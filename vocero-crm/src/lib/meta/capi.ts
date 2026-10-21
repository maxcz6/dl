import { graphRequest } from "@/lib/meta/client";

/**
 * 016 — Conversions API de Meta, variante `business_messaging`.
 *
 * Frontera de salida única: el mismo `graphRequest` con el que el CRM manda
 * mensajes. No hay un segundo camino a internet, ni un cliente nuevo, ni una
 * dependencia nueva: es la misma Graph API del canal que ya usa la instancia.
 *
 * Qué hace esto por el negocio: Meta sabe qué conversaciones EMPEZARON desde un
 * anuncio, pero no sabe cuáles sirvieron. Sin nadie que se lo diga, optimiza
 * hacia lo único que ve —que alguien abra el chat— y entrega el público más
 * barato de hacer escribir, que no es el que compra.
 */

/** Cómo se identifica el software que integró el evento. Constante del proyecto. */
const PARTNER_AGENT = "vocero-crm";

export type BusinessMessagingEvent = {
  eventName: string;
  /** Epoch en SEGUNDOS del momento de la conversión. */
  eventTime: number;
  ctwaClid: string;
  wabaId: string;
  /**
   * `custom_data` del evento. Importa más de lo que parece: es lo ÚNICO contra
   * lo que una **conversión personalizada** de Meta puede escribir reglas. Ni
   * `event_name` ni `action_source` son parámetros reglables, y estos eventos
   * no llevan `event_source_url`, así que un evento sin `custom_data` no puede
   * cumplir NINGUNA regla — y una conversión personalizada sin reglas
   * cumplibles se queda en cero para siempre, sin decir por qué.
   */
  customData?: Record<string, unknown>;
};

/**
 * Catálogo CERRADO de `event_name` que Meta acepta con
 * `action_source: "business_messaging"`. Cualquier otro nombre es un 400 opaco.
 *
 * Vocero solo emite dos de ellos (`QualifiedLead` y `Purchase`); la lista
 * completa vive aquí para que un fork que agregue el suyo no descubra el
 * catálogo a golpes.
 *
 * Doc: /docs/marketing-api/conversions-api/business-messaging
 */
export const META_BUSINESS_MESSAGING_EVENTS = [
  "Purchase",
  "LeadSubmitted",
  "QualifiedLead",
  "InitiateCheckout",
  "AddToCart",
  "ViewContent",
  "OrderCreated",
  "OrderShipped",
  "OrderDelivered",
  "OrderCanceled",
  "OrderReturned",
  "CartAbandoned",
  "RatingProvided",
  "ReviewProvided",
] as const;

export type MetaBusinessMessagingEvent =
  (typeof META_BUSINESS_MESSAGING_EVENTS)[number];

export function isMetaBusinessMessagingEvent(
  name: string
): name is MetaBusinessMessagingEvent {
  return (META_BUSINESS_MESSAGING_EVENTS as readonly string[]).includes(name);
}

/**
 * Meta responde 200 aunque no haya contabilizado nada: `events_received` es el
 * único acuse real. Sin mirarlo, "enviado" solo significaría "no hubo un HTTP
 * de error", y un evento descartado en silencio se vería idéntico a uno bueno.
 */
export type CapiAck = {
  eventsReceived: number;
  fbTraceId: string | null;
  /** Respuesta cruda: cuando algo no cuadra, el `messages[]` de Meta dice más. */
  raw: unknown;
};

export async function sendBusinessMessagingEvent(input: {
  datasetId: string;
  token: string;
  event: BusinessMessagingEvent;
}): Promise<CapiAck> {
  // Validar ANTES de armar el payload: un nombre fuera del catálogo se rechaza
  // con un 400 opaco, así que se falla aquí y con el motivo escrito.
  if (!isMetaBusinessMessagingEvent(input.event.eventName)) {
    throw new Error(
      `"${input.event.eventName}" no está en el catálogo de eventos ` +
        `business_messaging de Meta (${META_BUSINESS_MESSAGING_EVENTS.join(", ")})`
    );
  }

  const res = await graphRequest<{
    events_received?: number;
    fbtrace_id?: string;
  }>(`${input.datasetId}/events`, {
    method: "POST",
    token: input.token,
    body: buildEventPayload(input.event),
  });

  const eventsReceived = res?.events_received ?? 0;
  if (eventsReceived < 1) {
    // 200 con cero recibidos: Meta lo descartó. Se falla para que la fila quede
    // `failed` con el motivo, en vez de un `sent` que miente.
    throw new Error(
      `Meta respondió 200 pero events_received=${eventsReceived} ` +
        `(evento descartado; fbtrace_id: ${res?.fbtrace_id ?? "n/d"})`
    );
  }

  return {
    eventsReceived,
    fbTraceId: res?.fbtrace_id ?? null,
    raw: res,
  };
}

/**
 * Arma el body de `POST {dataset}/events`. Separada y exportada para poder
 * fijar la FORMA del payload en un test: el modo de fallar de este endpoint es
 * un 200 con `events_received: 0`, donde un campo mal puesto se ve exactamente
 * igual que uno bien puesto.
 */
export function buildEventPayload(
  event: BusinessMessagingEvent
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    event_name: event.eventName,
    event_time: event.eventTime,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    // Hacia Meta NO viaja teléfono, nombre ni texto del contacto: solo el
    // identificador del clic y el de la cuenta de WhatsApp del negocio.
    user_data: {
      ctwa_clid: event.ctwaClid,
      whatsapp_business_account_id: event.wabaId,
    },
  };

  // Se omite si queda vacío: mandar `custom_data: {}` no aporta nada reglable y
  // ensucia el payload que uno inspecciona cuando algo falla.
  if (event.customData && Object.keys(event.customData).length > 0) {
    data.custom_data = event.customData;
  }

  return { data: [data], partner_agent: PARTNER_AGENT };
}
