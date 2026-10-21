/**
 * Traduce el error de envío de Meta a algo que el operador pueda ACCIONAR.
 *
 * Meta manda el motivo en inglés y en jerga propia ("User's number is part of
 * an experiment"), y el CRM lo guardaba sin mostrarlo: el mensaje fallido solo
 * enseñaba un triángulo mudo. Aquí se convierte en una frase que dice qué
 * pasó y qué hacer, conservando el código para poder rastrearlo en la
 * documentación de Meta.
 */

const DESCRIPTIONS: Record<number, string> = {
  130472:
    "Meta tiene el número del destinatario en un experimento y le está bloqueando los mensajes de MARKETING. No es un fallo de tu configuración: prueba con una plantilla de categoría UTILITY o con otro número.",
  131049:
    "Meta limitó los mensajes de marketing hacia este usuario para cuidar la calidad del ecosistema. Espera o usa una plantilla de categoría UTILITY.",
  131047:
    "Pasaron más de 24 h desde el último mensaje del cliente: solo se puede reabrir con una plantilla aprobada.",
  131048:
    "Meta frenó el envío por límite de spam en tu número. Baja el ritmo de envíos y revisa la calidad del número.",
  131026:
    "El destinatario no puede recibir mensajes de WhatsApp (número inexistente, sin cuenta o que no acepta mensajes de empresas).",
  131031:
    "Tu cuenta de WhatsApp Business está bloqueada o restringida por Meta. Revísalo en el Administrador de WhatsApp.",
  131030:
    "El número del destinatario no está en la lista de permitidos de tu app en modo de prueba.",
  130429:
    "Superaste el límite de mensajes por segundo de Meta. Reintenta en unos momentos.",
  132000:
    "La plantilla y los parámetros enviados no coinciden (faltan o sobran variables).",
  132001:
    "Meta no encuentra esa plantilla con ese idioma. Sincroniza las plantillas y confirma que sigue aprobada.",
  132005:
    "El texto traducido de la plantilla supera el límite de caracteres de Meta.",
  132007:
    "El contenido de la plantilla viola las políticas de Meta.",
  132012:
    "Los parámetros de la plantilla no respetan el formato que Meta espera.",
  132015:
    "La plantilla está pausada por baja calidad: Meta no la deja enviar hasta que se recupere.",
  132016:
    "La plantilla fue deshabilitada por calidad y ya no se puede enviar.",
  133010: "El número no está registrado en la Cloud API.",
  368: "El número está temporalmente bloqueado por infringir las políticas de Meta.",
};

/**
 * @param code   Código numérico de Meta (`errors[0].code`), si vino.
 * @param detail Texto crudo de Meta, como respaldo cuando el código es nuevo.
 */
export function describeSendError(
  code: number | null | undefined,
  detail?: string | null
): string {
  const known = code != null ? DESCRIPTIONS[code] : undefined;
  // `||` y no `??`: Meta a veces manda el texto vacío o en blanco, y un
  // mensaje de error vacío es tan inútil como el triángulo mudo.
  const base = known || detail?.trim() || "Meta rechazó el envío";
  return code != null ? `${base} (Meta ${code})` : base;
}
