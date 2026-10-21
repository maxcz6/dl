import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { estadoIaDe, mensajeDeEstado } from "@/lib/ai/provider";
import { agendaEnabled } from "@/server/agenda/flag";
import { verifyCalendar } from "./calendar-verifiers";
import { leerConfigDespacho, urlSaludCerebro } from "@/server/brains/config";
import { getBrainHealth } from "@/server/bot/status";

/**
 * Qué le falta a esta instancia para que el agente conteste (issue #86).
 *
 * Puerto de `onboarding/status.ts` de Vocero Cloud recortado a lo que la raíz
 * tiene: el perfil del agente, la credencial de IA (la fila de Ajustes → IA
 * o, de respaldo, `OPENROUTER_*` del entorno), el número de WhatsApp y, solo
 * con `AGENDA=on`, la agenda. Nada de modelo de plataforma, dueño invitado,
 * cerebro compartido, cobertura ni evidencia de prueba: aquí una instancia es
 * un negocio y quien la instala es quien la configura.
 *
 * Cada paso sale de la MISMA fuente que ya decide si esa pieza funciona
 * (`estadoIaDe`, el `status` de la conexión, el catálogo de conectores): la
 * guía no inventa su propia noción de «listo».
 */
export type ReadinessStatus =
  | "ready"
  | "pending"
  | "unsupported"
  | "not_applicable";

export type ReadinessKey = "profile" | "ai" | "whatsapp" | "brain" | "calendar";

export type ReadinessStep = {
  key: ReadinessKey;
  label: string;
  status: ReadinessStatus;
  /** Qué hacer para dejarlo listo; en `ready`, qué quedó. */
  nextAction: string;
  href: string | null;
  /**
   * Lo que está MAL, cuando no es simplemente que falte el paso: la llave
   * rechazada, el token de WhatsApp vencido, un conector sin credencial. La
   * guía lo pinta en ámbar debajo del paso.
   */
  problem: string | null;
};

export type OnboardingStatus = {
  steps: ReadinessStep[];
  /** El agente ya está encendido: el CRM le despacha al cerebro (036). */
  enabled: boolean;
};

type Db = ReturnType<typeof getDb>;

export async function onboardingStatus(
  organizationId: string,
  db: Db = getDb()
): Promise<OnboardingStatus> {
  const [profile] = await db
    .select({
      name: schema.agentProfile.name,
      instructions: schema.agentProfile.instructions,
      enabled: schema.agentProfile.enabled,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const [kb] = await db
    .select({ id: schema.kbEntry.id })
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId))
    .limit(1);
  const [channel] = await db
    .select({ status: schema.metaCredentials.status })
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  const ia = await estadoIaDe(organizationId);

  const steps: ReadinessStep[] = [
    pasoPerfil(profile, Boolean(kb)),
    {
      key: "ai",
      label: "Proveedor de IA",
      status: ia.activa ? "ready" : "pending",
      nextAction: ia.activa
        ? ia.origen === "org"
          ? "Llave guardada en Ajustes → IA"
          : "Respaldo del entorno (OPENROUTER_*)"
        : "Pega la llave de tu proveedor y elige el modelo en Ajustes → IA",
      href: "/settings/ai",
      // «Sin configurar» es lo obvio del paso; lo que sí hay que decir es por
      // qué una llave que el dueño YA pegó no sirve.
      problem:
        !ia.activa && ia.motivo !== "sin_configurar"
          ? mensajeDeEstado(ia)
          : null,
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      status: channel?.status === "connected" ? "ready" : "pending",
      nextAction:
        channel?.status === "connected"
          ? "Número conectado"
          : channel
            ? "Vuelve a conectar el número con un token vigente"
            : "Vincular tu número",
      href: "/settings/whatsapp",
      problem:
        channel?.status === "reconnect_required"
          ? "Meta dejó de aceptar el token de WhatsApp: vuelve a conectar el número."
          : null,
    },
    await pasoCerebro(),
  ];

  if (agendaEnabled()) {
    steps.push(await pasoAgenda(organizationId, db));
  } else {
    // Sin la bandera, la agenda no existe en esta instancia (015): el paso se
    // reporta para que la guía sepa que no aplica, sin enlace a una pantalla
    // que respondería 404.
    steps.push({
      key: "calendar",
      label: "Agenda",
      status: "not_applicable",
      nextAction:
        "La agenda no está encendida en esta instancia (variable AGENDA).",
      href: null,
      problem: null,
    });
  }

  return { steps, enabled: profile?.enabled ?? false };
}

type Perfil = { name: string; instructions: string | null; enabled: boolean };

/**
 * 036 — «Conecta tu agente». El CRM ya no trae agente: contesta el cerebro al
 * que se le despacha (Nea u otro). La dirección vive en el entorno
 * (`BRAIN_DISPATCH_URL`, spec 036 D3), así que el paso no tiene pantalla a la
 * que llevar: dice qué falta y lleva a la guía. Listo cuando el despacho está
 * configurado y el `/health` del cerebro contesta.
 */
async function pasoCerebro(): Promise<ReadinessStep> {
  const base = { key: "brain" as const, label: "Tu agente", href: null };
  const despacho = leerConfigDespacho();
  if (!despacho.active) {
    return {
      ...base,
      status: "pending",
      nextAction:
        "Levanta tu agente (Nea) al lado del CRM y pon BRAIN_DISPATCH_URL y BOT_API_KEY en el entorno",
      problem:
        despacho.problem === "url"
          ? "BRAIN_DISPATCH_URL no es una dirección válida."
          : despacho.problem === "sin_llave"
            ? "Falta BOT_API_KEY (16 caracteres o más): sin ella no se firma el despacho."
            : null,
    };
  }
  const salud = await getBrainHealth(urlSaludCerebro() ?? undefined);
  if (salud && !salud.reachable) {
    return {
      ...base,
      status: "pending",
      nextAction: `Tu agente (${despacho.host}) está configurado pero no contesta`,
      problem: `El /health de ${salud.host || despacho.host} no responde: revisa que el servicio esté corriendo.`,
    };
  }
  return {
    ...base,
    status: "ready",
    nextAction: salud?.version
      ? `Conectado: ${despacho.host} (versión ${salud.version})`
      : `Conectado: ${despacho.host}`,
    problem: null,
  };
}

/**
 * El agente está «configurado» cuando tiene con qué contestar: instrucciones
 * o conocimiento. El nombre viene con default («Asistente»), así que no es
 * lo que distingue a un perfil trabajado de uno recién sembrado.
 */
function pasoPerfil(profile: Perfil | undefined, hayConocimiento: boolean): ReadinessStep {
  const listo =
    Boolean(profile?.name.trim()) &&
    (Boolean(profile?.instructions?.trim()) || hayConocimiento);
  return {
    key: "profile",
    label: "Configuración del agente",
    status: listo ? "ready" : "pending",
    nextAction: listo
      ? "Nombre, instrucciones y conocimiento revisados"
      : "Dale un nombre y escribe sus instrucciones o carga conocimiento del negocio",
    href: "/agent",
    problem: null,
  };
}

async function pasoAgenda(organizationId: string, db: Db): Promise<ReadinessStep> {
  const [settings] = await db
    .select({
      connector: schema.calendarSettings.connector,
      weeklyHours: schema.calendarSettings.weeklyHours,
    })
    .from(schema.calendarSettings)
    .where(scoped(schema.calendarSettings.organizationId, organizationId))
    .limit(1);
  const [zoom] = await db
    .select({ status: schema.zoomCredentials.status })
    .from(schema.zoomCredentials)
    .where(scoped(schema.zoomCredentials.organizationId, organizationId))
    .limit(1);
  const [google] = await db
    .select({ status: schema.googleCredentials.status })
    .from(schema.googleCredentials)
    .where(scoped(schema.googleCredentials.organizationId, organizationId))
    .limit(1);

  const status = verifyCalendar(settings, {
    zoom: zoom?.status === "connected",
    google: google?.status === "connected",
  });

  let problem: string | null = null;
  if (status === "unsupported") {
    problem = `El conector «${settings?.connector}» no existe en esta instancia: elige otro en Ajustes → Agenda.`;
  } else if (status === "pending" && settings && settings.connector !== "enlace-fijo") {
    const nombre = settings.connector === "zoom" ? "Zoom" : "Google";
    const cred = settings.connector === "zoom" ? zoom : google;
    problem = cred
      ? `${nombre} rechazó la credencial guardada: vuelve a conectarlo en Ajustes → Agenda.`
      : `Elegiste ${nombre} pero no está conectado: pega sus credenciales en Ajustes → Agenda.`;
  }

  return {
    key: "calendar",
    label: "Agenda",
    status,
    nextAction:
      status === "ready"
        ? "Horarios y conector listos"
        : "Guarda tus horarios y cómo se entrega la reunión en Ajustes → Agenda",
    href: "/settings/calendar",
    problem,
  };
}
