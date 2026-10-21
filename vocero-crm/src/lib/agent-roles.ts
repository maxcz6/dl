/**
 * 034 — Roles como datos.
 *
 * Un rol es lo que hace el agente: instrucciones, herramientas encendidas y
 * las personas con que el Laboratorio lo prueba. El runtime es uno y vive en
 * el cerebro; lo que cambia de un negocio a otro vive aquí y en el perfil, y
 * viaja por `GET /api/bot/profile`. Encender o apagar una herramienta es
 * editar el perfil, sin redesplegar nada.
 *
 * Puro y sin dependencias del servidor: lo usan la API, la pantalla Agente y
 * el Laboratorio.
 */

export type ClaveHerramienta =
  | "ficha"
  | "etapa"
  | "agendar"
  | "reprogramar"
  | "salida"
  | "escalar";

export type Herramienta = {
  clave: ClaveHerramienta;
  etiqueta: string;
  descripcion: string;
  /** Solo existe con la bandera `AGENDA` encendida. */
  agenda?: true;
  /** Red de seguridad: no se apaga (spec 034, D2). */
  fija?: true;
};

/** El catálogo. Las claves son contrato con el cerebro: no se renombran. */
export const HERRAMIENTAS: readonly Herramienta[] = [
  {
    clave: "ficha",
    etiqueta: "Llenar la ficha",
    descripcion:
      "Anota lo que aprende del cliente en su ficha del CRM.",
  },
  {
    // 038 — Solo hacia adelante y entre etapas abiertas: ganar o perder un
    // trato lo decide una persona.
    clave: "etapa",
    etiqueta: "Mover de etapa",
    descripcion:
      "Avanza al lead en el pipeline cuando la conversación lo amerita. Nunca lo da por ganado ni por perdido.",
  },
  {
    clave: "agendar",
    etiqueta: "Agendar citas",
    descripcion: "Ofrece horarios reales de la agenda y reserva el que elija el cliente.",
    agenda: true,
  },
  {
    clave: "reprogramar",
    etiqueta: "Reprogramar citas",
    descripcion: "Mueve una cita ya reservada a otro horario ofrecido.",
    agenda: true,
  },
  {
    clave: "salida",
    etiqueta: "Salida digna",
    descripcion: "Despide con amabilidad a quien no califica, con recursos si los hay.",
  },
  {
    clave: "escalar",
    etiqueta: "Pasar a una persona",
    descripcion:
      "Cuando el cliente lo pide, ante hostilidad o lo que no sabe. Siempre encendida.",
    fija: true,
  },
];

export const CLAVES_HERRAMIENTA: readonly ClaveHerramienta[] = HERRAMIENTAS.map(
  (h) => h.clave
);

export function esClaveHerramienta(valor: unknown): valor is ClaveHerramienta {
  return typeof valor === "string" && (CLAVES_HERRAMIENTA as string[]).includes(valor);
}

/**
 * Las herramientas encendidas de un perfil: `null` = todas (lo que tiene una
 * instalación que actualiza). `escalar` siempre va, y en el orden del
 * catálogo. Lo que no es del catálogo se ignora.
 */
export function herramientasEfectivas(
  tools: readonly string[] | null | undefined
): ClaveHerramienta[] {
  if (!tools) return [...CLAVES_HERRAMIENTA];
  const encendidas = new Set(tools.filter(esClaveHerramienta));
  return HERRAMIENTAS.filter((h) => h.fija || encendidas.has(h.clave)).map((h) => h.clave);
}

export type ClaveRol = "calificador";

export type Rol = {
  clave: ClaveRol;
  etiqueta: string;
  descripcion: string;
  instrucciones: string;
  reglasDeEscalado: string;
  herramientas: readonly ClaveHerramienta[];
  /** Claves de las personas del Laboratorio (`src/server/lab/personas.ts`). */
  personas: readonly string[];
};

/** Los roles. En 2.0, uno: el Calificador (spec 034, D7). */
export const ROLES: Record<ClaveRol, Rol> = {
  calificador: {
    clave: "calificador",
    etiqueta: "Calificador",
    descripcion:
      "Atiende a quien escribe, entiende qué necesita, lo califica y agenda con el equipo cuando corresponde.",
    instrucciones: [
      "Atiendes a las personas que le escriben al negocio. Tu trabajo:",
      "1. Entender qué necesita cada persona, con una pregunta a la vez.",
      "2. Responder con lo que dice el conocimiento del negocio; si algo no está ahí, no lo inventes: ofrece pasarle la duda al equipo.",
      "3. Calificarla: anota en la ficha lo que vas sabiendo (qué busca, para cuándo, presupuesto si lo dice).",
      "4. Si califica, ofrécele una cita con el equipo. Si no, despídela con amabilidad y, si hay recursos, compártelos.",
    ].join("\n"),
    reglasDeEscalado:
      "Pasa la conversación a una persona si el cliente lo pide, si se pone hostil, si es una queja o un problema con una compra, o si pregunta algo que el conocimiento no cubre y le importa.",
    herramientas: CLAVES_HERRAMIENTA,
    personas: [
      "comprador_decidido",
      "pregunton_precios",
      "cliente_enojado",
      "hostil",
      "fuera_de_kb",
      "pide_humano",
      "errores_modismos",
      "sin_rumbo",
    ],
  },
};

export function esClaveRol(valor: unknown): valor is ClaveRol {
  return typeof valor === "string" && valor in ROLES;
}

/** El rol de un perfil; uno que ya no exista cae al Calificador. */
export function rolDe(role: string | null | undefined): Rol {
  return esClaveRol(role) ? ROLES[role] : ROLES.calificador;
}
