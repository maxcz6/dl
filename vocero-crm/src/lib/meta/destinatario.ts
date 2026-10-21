/**
 * A quién va un mensaje de la Cloud API: teléfono o BSUID.
 *
 * Meta los pide en campos DISTINTOS, y esa es toda la historia de este módulo:
 *
 *   - teléfono → `{ to: "<E.164>" }`
 *   - BSUID    → `{ recipient_type: "individual", recipient: "<BSUID>" }`
 *
 * Se mandaba el BSUID en `to`, donde Meta espera un número. La respuesta era
 * un 131026 —«el destinatario no puede recibir mensajes de WhatsApp (número
 * inexistente, sin cuenta o que no acepta mensajes de empresas)»— así que el
 * CRM le echaba la culpa al cliente del miembro por un campo mal puesto.
 *
 * Cuándo llega un contacto sin teléfono, según la documentación de Meta: el
 * usuario activó el nombre de usuario, no ha habido interacción con ese número
 * de empresa en 30 días, y no está en la agenda. Las tres a la vez. Por eso
 * fallaba con unos contactos y con otros no, que es justo lo que lo hacía
 * parecer un misterio.
 *
 * Vive aparte porque hay CUATRO sitios que arman envíos (texto, adjuntos,
 * ubicación/contactos y plantillas) y con una copia en cada uno bastaría con
 * olvidar la quinta.
 */
export type Destinatario =
  | { to: string }
  | { recipient_type: "individual"; recipient: string };

/**
 * `phone` gana cuando existe: la documentación dice que si van los dos, el
 * teléfono tiene precedencia, así que mandar ambos solo añadiría ruido.
 */
export function destinatarioMeta(
  phone: string | null,
  bsuid: string | null
): Destinatario | null {
  if (phone) return { to: phone };
  if (bsuid) return { recipient_type: "individual", recipient: bsuid };
  return null;
}

/** ¿Este destinatario es un BSUID? Para decidir qué se puede mandarle. */
export function esBsuid(d: Destinatario): boolean {
  return "recipient" in d;
}
