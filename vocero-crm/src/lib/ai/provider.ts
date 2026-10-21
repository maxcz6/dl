import { isAiConfiguredByEnv } from "@/lib/env";
import { last4, OPENROUTER_BASE_URL } from "@/lib/ai/presets";
import {
  getAiCredentialPublic,
  getAiCredentialSecret,
  type AiCredentialPublic,
  type AiCredentialSecret,
} from "@/server/ai/credentials";

/**
 * Con qué proveedor de IA habla esta organización (issue #85).
 *
 * Precedencia: lo guardado en Ajustes → IA manda; las variables
 * `OPENROUTER_*` del entorno quedan como respaldo para instalaciones
 * automatizadas (o para quien ya las tenía). Una fila PAUSADA no cae al
 * entorno: el dueño configuró su llave, y que el agente siguiera hablando con
 * otra sin decírselo sería esconderle el problema que tiene que arreglar.
 *
 * Las funciones puras (`interpretarCredencial`, `resolver`) existen para
 * probar la tabla de decisión sin base de datos.
 */

export type AiProvider = {
  source: "org" | "env";
  baseUrl: string;
  model: string;
  judgeModel: string;
  token: string;
};

export type EstadoIa =
  | { activa: true; origen: "org" | "env"; last4: string }
  | { activa: false; motivo: "sin_configurar" }
  | {
      activa: false;
      motivo: "token_invalido" | "sin_saldo";
      last4: string;
      desde: Date | null;
    };

export type AiResolution =
  | { ok: true; provider: AiProvider }
  | { ok: false; estado: Exclude<EstadoIa, { activa: true }> };

/**
 * El respaldo del entorno, o `null` sin `OPENROUTER_API_TOKEN`. El modelo
 * puede venir vacío: eso lo reporta `chatJson` como `not_configured` con su
 * detalle, igual que antes.
 *
 * Se lee de `process.env` directo, no por `getEnv()`, igual que
 * `isMockEnabled()` y las banderas: preguntar si hay IA no puede depender de
 * que TODO el entorno valide. Con `getEnv()`, un turno del agente reventaba
 * —en vez de degradar— solo por consultar esto (ver `server/agenda/flag.ts`).
 * Los strings vacíos cuentan como ausentes, como en `getEnv()`.
 */
export function envAiProvider(): AiProvider | null {
  if (!isAiConfiguredByEnv()) return null;
  const model = leer("OPENROUTER_MODEL") ?? "";
  return {
    source: "env",
    baseUrl: leer("OPENROUTER_BASE_URL") ?? OPENROUTER_BASE_URL,
    model,
    judgeModel: leer("OPENROUTER_JUDGE_MODEL") ?? model,
    token: leer("OPENROUTER_API_TOKEN") ?? "",
  };
}

function leer(nombre: string): string | undefined {
  const v = process.env[nombre];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

type CredEstado = Pick<
  AiCredentialPublic,
  "status" | "tokenLast4" | "statusChangedAt"
>;

/** Pura: la fila manda; sin fila, el entorno; sin nada, sin configurar. */
export function interpretarCredencial(
  cred: CredEstado | null,
  env: { last4: string } | null
): EstadoIa {
  if (cred) {
    if (cred.status === "active") {
      return { activa: true, origen: "org", last4: cred.tokenLast4 };
    }
    return {
      activa: false,
      motivo:
        cred.status === "paused_invalid_token" ? "token_invalido" : "sin_saldo",
      last4: cred.tokenLast4,
      desde: cred.statusChangedAt,
    };
  }
  if (env) return { activa: true, origen: "env", last4: env.last4 };
  return { activa: false, motivo: "sin_configurar" };
}

/** Pura: la resolución completa, con el token, para el adaptador. */
export function resolver(
  cred: AiCredentialSecret | null,
  env: AiProvider | null
): AiResolution {
  const estado = interpretarCredencial(
    cred,
    env ? { last4: last4(env.token) } : null
  );
  if (!estado.activa) return { ok: false, estado };
  if (estado.origen === "org" && cred) {
    return {
      ok: true,
      provider: {
        source: "org",
        baseUrl: cred.baseUrl,
        model: cred.model,
        // Un solo modelo en la UI: el juez del Laboratorio usa el mismo.
        judgeModel: cred.model,
        token: cred.token,
      },
    };
  }
  if (env) return { ok: true, provider: env };
  return { ok: false, estado: { activa: false, motivo: "sin_configurar" } };
}

/**
 * Sin organización (una llamada suelta) solo cuenta el entorno: no hay fila
 * que consultar.
 */
export async function resolveAiProvider(
  organizationId?: string
): Promise<AiResolution> {
  const cred = organizationId
    ? await getAiCredentialSecret(organizationId)
    : null;
  return resolver(cred, envAiProvider());
}

export async function estadoIaDe(organizationId: string): Promise<EstadoIa> {
  const cred = await getAiCredentialPublic(organizationId);
  const env = envAiProvider();
  return interpretarCredencial(cred, env ? { last4: last4(env.token) } : null);
}

/** Atajo para los sitios que solo necesitan el sí/no. */
export async function isAiConfiguredFor(
  organizationId: string
): Promise<boolean> {
  return (await estadoIaDe(organizationId)).activa;
}

/** El mensaje que ve el dueño cuando su agente no puede contestar. */
export function mensajeDeEstado(estado: EstadoIa): string | null {
  if (estado.activa) return null;
  switch (estado.motivo) {
    case "sin_configurar":
      // «Apagado» no: el interruptor de la pantalla Agente puede decir
      // «Encendido». El problema no es que esté apagado, es que no tiene con
      // qué pensar.
      return "Tu agente no puede contestar todavía: configura tu proveedor de IA en Ajustes → IA.";
    case "token_invalido":
      return "Tu agente está pausado: el proveedor rechazó tu llave. Revísala en Ajustes → IA.";
    case "sin_saldo":
      return "Tu agente está pausado: tu cuenta del proveedor de IA se quedó sin saldo. Recárgala y pulsa «Probar conexión» en Ajustes → IA.";
  }
}
