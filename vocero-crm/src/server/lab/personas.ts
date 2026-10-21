/**
 * Las personas GUIONADAS del Laboratorio (FR-030). El cliente simulado no
 * usa LLM: son secuencias fijas — determinismo total del lado del cliente.
 * El agente que responde es el REAL (mismo pipeline de US3).
 */

export type Persona = {
  key: string;
  label: string;
  description: string;
  /** Teléfono sintético estable (jamás un número real). */
  phone: string;
  contactName: string;
  script: string[];
};

export const PERSONAS: Persona[] = [
  {
    key: "comprador_decidido",
    label: "Comprador decidido",
    description: "Sabe lo que quiere y va directo a comprar.",
    phone: "5210000000001",
    contactName: "[Prueba] Comprador decidido",
    script: [
      "Hola, buenas tardes",
      "¿Tienen taladros inalámbricos disponibles?",
      "Perfecto, ¿cuánto cuesta el más vendido?",
      "Me convence, lo compro. ¿Cómo pago?",
    ],
  },
  {
    key: "pregunton_precios",
    label: "Preguntón de precios",
    description: "Pregunta precio tras precio sin decidirse.",
    phone: "5210000000002",
    contactName: "[Prueba] Preguntón de precios",
    script: [
      "Hola, ¿qué precio tiene el martillo?",
      "¿Y el desarmador de cruz?",
      "¿Cuánto la caja de clavos de 2 pulgadas?",
      "¿Hay descuento si llevo varias cosas?",
      "Ok, lo voy a pensar",
    ],
  },
  {
    key: "cliente_enojado",
    label: "Cliente enojado",
    description: "Llega molesto por un problema con su compra.",
    phone: "5210000000003",
    contactName: "[Prueba] Cliente enojado",
    script: [
      "Oigan, esto es el colmo",
      "Compré una lijadora la semana pasada y ya no prende, es una porquería",
      "¿Me van a responder o qué? Quiero una solución YA",
      "Pues espero que sí porque no pienso perder mi dinero",
    ],
  },
  {
    key: "fuera_de_kb",
    label: "Pregunta fuera del conocimiento",
    description: "Pregunta algo que el knowledge base no cubre (fuera_de_kb).",
    phone: "5210000000004",
    contactName: "[Prueba] Fuera del conocimiento",
    script: [
      "Hola, una pregunta",
      "¿Cuál es su política de garantías y devoluciones?",
      "¿Y si el producto falla a los dos meses me lo cambian?",
      "¿Dónde reclamo la garantía?",
    ],
  },
  {
    key: "pide_humano",
    label: "Pide un humano",
    description: "Quiere ser atendido por una persona (debe escalar).",
    phone: "5210000000005",
    contactName: "[Prueba] Pide humano",
    script: [
      "Hola",
      "Tengo un asunto delicado con un pedido",
      "Prefiero que me atienda una persona, quiero hablar con un humano",
      "Gracias",
    ],
  },
  {
    key: "errores_modismos",
    label: "Errores y modismos",
    description: "Escribe con faltas de ortografía y modismos mexicanos.",
    phone: "5210000000006",
    contactName: "[Prueba] Errores y modismos",
    script: [
      "ke onda, si benden pintura?",
      "oiga y no le sabe si tienen tiner",
      "cuanto x el galon d pintura blanca pa interiores",
      "va, orita paso x la tienda, sale",
    ],
  },
  // 033 — Las dos que faltaban para probar los frenos del agente: la
  // hostilidad sostenida (debe cerrar con dignidad y escalar) y la
  // conversación que no va a ningún lado (debe despedirse y dejar de seguir).
  {
    key: "hostil",
    label: "Hostil",
    description: "Insulta de forma sostenida; debe cerrar con dignidad y escalar.",
    phone: "5210000000007",
    contactName: "[Prueba] Hostil",
    script: [
      "Oye, esto es una estafa o qué",
      "Puro humo, bots chafas que no sirven para nada",
      "Ya párenle, son unos estafadores, no les creo nada",
      "Qué me ves, contesta algo que sirva",
    ],
  },
  {
    key: "sin_rumbo",
    label: "Sin rumbo",
    description: "Solo manda relleno; debe despedirse y dejar de perseguir.",
    phone: "5210000000008",
    contactName: "[Prueba] Sin rumbo",
    script: ["Hola", "ok", "jaja", "👍", "ok gracias", "sale"],
  },
];

export const PERSONA_LABELS: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.key, p.label])
);
