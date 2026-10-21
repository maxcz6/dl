import type { SessionContext } from "@/lib/auth/session";
import { canConfigure } from "@/lib/auth/roles";
import {
  onboardingStatus,
  type OnboardingStatus,
  type ReadinessStep,
} from "./status";

/**
 * La guía de inicio: cuatro pasos (cinco con la agenda) y nada más (issue #86).
 * 036 — «Conecta tu agente» es opcional: sin él, Vocero es una bandeja manual.
 *
 * Es lo primero que ve quien instala Vocero: configurar el agente, vincular
 * el proveedor de IA, conectar el número y, si la agenda existe en esta
 * instancia, dejarla lista. Al terminar, un botón enciende el agente. Lo
 * demás —la Bandeja, el Pipeline— ya está en el menú; la guía no lo repite.
 *
 * El estado de cada paso sale de `onboardingStatus`, la misma fuente que ya
 * verifica cada conexión: la guía no inventa su propia noción de «listo».
 * Puerto de `onboarding/guide.ts` de Vocero Cloud sin lo que allá es de la
 * plataforma (modelo fijado por soporte, agencias, planes).
 */
export type GuideStep = {
  key: "agent" | "ai" | "whatsapp" | "brain" | "calendar";
  title: string;
  description: string;
  done: boolean;
  /** 036 — En «Conecta tu agente» es externo (la receta del par): se hace en
   *  el entorno, no en una pantalla. */
  href: string;
  cta: string;
  /** Lo que falta, cuando no es lo obvio del paso. */
  hint: string | null;
  /** 036 — No cuenta para `complete`: sin cerebro, Vocero es una bandeja
   *  manual, y eso es un producto válido. */
  optional?: boolean;
};

export type Guide = {
  steps: GuideStep[];
  complete: boolean;
  /** El agente ya está encendido. */
  enabled: boolean;
  /** 036 — Hay un cerebro conectado y sano: tiene sentido encender. */
  brainConnected: boolean;
};

/** 036 — A dónde lleva «Conecta tu agente»: la receta del par. */
export const GUIA_DEL_PAR =
  "https://github.com/kevinrivm/vocero-crm/blob/main/docs/migrar-a-2.0.md#el-par-crm--nea";

const ready = (s: ReadinessStep | undefined) => s?.status === "ready";

/** Pura: de los pasos verificados a los de la guía. */
export function guideFrom(status: OnboardingStatus): Guide {
  const step = (key: ReadinessStep["key"]) =>
    status.steps.find((s) => s.key === key);
  const profile = step("profile");
  const ai = step("ai");
  const whatsapp = step("whatsapp");
  const calendar = step("calendar");
  const brain = step("brain");

  const steps: GuideStep[] = [
    {
      key: "agent",
      title: "Configura tu agente",
      description:
        "Ponle nombre y cuéntale a qué se dedica tu negocio. Si quieres ver un ejemplo primero, carga la demo desde la Bandeja y cámbiala por tus datos.",
      done: ready(profile),
      href: "/agent",
      cta: "Ir a Agente",
      hint: ready(profile) ? null : (profile?.nextAction ?? null),
    },
    {
      key: "ai",
      title: "Vincula tu proveedor de IA",
      description:
        "Es la cuenta con la que tu agente piensa: OpenRouter o cualquier proveedor compatible con la API de OpenAI. La creas y la pagas tú; aquí solo pegas la llave y eliges el modelo.",
      done: ready(ai),
      href: "/settings/ai",
      cta: "Vincular proveedor",
      hint: ai?.problem ?? null,
    },
    {
      key: "whatsapp",
      title: "Vincula tu número de WhatsApp",
      description:
        "Conecta el número donde te escriben tus clientes. El CRM registra el webhook en Meta por ti al guardar.",
      done: ready(whatsapp),
      href: "/settings/whatsapp",
      cta: "Conectar WhatsApp",
      hint: whatsapp?.problem ?? null,
    },
    {
      key: "brain",
      title: "Conecta tu agente",
      description:
        "Vocero no trae agente: contesta el que conectas al lado (Nea, o el tuyo). Sin agente, Vocero funciona como bandeja manual y contestas tú.",
      done: ready(brain),
      href: GUIA_DEL_PAR,
      cta: "Cómo conectarlo",
      hint: ready(brain) ? null : (brain?.problem ?? brain?.nextAction ?? null),
      optional: true,
    },
  ];
  // Sin agenda en esta instancia el paso no existe: pintarlo «no aplica»
  // sería justo el tipo de ruido que la guía evita.
  if (calendar && calendar.status !== "not_applicable") {
    steps.push({
      key: "calendar",
      title: "Configura tu agenda",
      description:
        "Define tus horarios y cómo se entrega la reunión para que tu agente pueda agendar por ti.",
      done: ready(calendar),
      href: "/settings/calendar",
      cta: "Configurar agenda",
      hint: calendar.problem,
    });
  }
  return {
    steps,
    complete: steps.every((s) => s.done || s.optional),
    enabled: status.enabled,
    brainConnected: ready(brain),
  };
}

export async function guideStatus(organizationId: string): Promise<Guide> {
  return guideFrom(await onboardingStatus(organizationId));
}

/**
 * ¿La guía es lo primero que ve esta persona al entrar?
 *
 * Solo a quien puede configurar (un miembro del equipo no puede hacer ninguno
 * de los pasos) y solo mientras falte algo: con todos los pasos listos y el
 * agente encendido se entra directo a la Bandeja, como siempre.
 *
 * Un negocio demo recién sembrado («Ferretería El Martillo») pasa por aquí
 * igual: el seed deja el agente configurado (paso 1 listo) pero no puede
 * vincular una llave de IA ni un número, y sin eso el agente no contesta.
 * Capturar `/` no encierra a nadie: el menú lleva a cualquier pantalla.
 */
export async function guideFirst(
  session: Pick<SessionContext, "organizationId" | "role">
): Promise<boolean> {
  if (!canConfigure(session.role)) return false;
  const guide = await guideStatus(session.organizationId);
  // 036 — Una bandeja manual (sin cerebro) no se queda atrapada en la guía.
  return !guide.complete || (guide.brainConnected && !guide.enabled);
}
