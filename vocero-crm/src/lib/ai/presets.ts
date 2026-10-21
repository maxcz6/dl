/**
 * Catálogo del proveedor de IA (Ajustes → IA). Sin imports de servidor: lo
 * leen también los componentes de cliente.
 *
 * Un preset es solo una ayuda para no escribir la `base_url` a mano. Lo que
 * identifica al proveedor en la base es la `base_url`: cualquier API
 * compatible con la de OpenAI sirve (OpenRouter, OpenAI, Groq, un vLLM
 * propio…), que es la única frontera con el LLM que admite la constitución.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

export const AI_PROVIDERS = ["openrouter", "openai_compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_STATUSES = [
  "active",
  "paused_invalid_token",
  "paused_no_credit",
] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export type AiProviderPreset = {
  id: AiProviderId;
  label: string;
  /** Fija en el preset; `null` = la escribe el dueño. */
  baseUrl: string | null;
  modelPlaceholder: string;
  tokenPlaceholder: string;
};

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
    modelPlaceholder: "anthropic/claude-sonnet-4.5",
    tokenPlaceholder: "sk-or-…",
  },
  openai_compatible: {
    id: "openai_compatible",
    label: "Otro compatible con OpenAI",
    baseUrl: null,
    modelPlaceholder: "gpt-4.1-mini",
    tokenPlaceholder: "sk-…",
  },
};

export const AI_STATUS_LABEL: Record<AiStatus, string> = {
  active: "Activo",
  paused_invalid_token: "Pausado: llave rechazada",
  paused_no_credit: "Pausado: sin saldo",
};

/** A qué preset corresponde una base URL (la del entorno o una guardada). */
export function presetDeBaseUrl(baseUrl: string): AiProviderId {
  return apiRoot(baseUrl) === apiRoot(OPENROUTER_BASE_URL)
    ? "openrouter"
    : "openai_compatible";
}

/**
 * La raíz `/v1` de una API OpenAI-compatible.
 *
 * La convención del repo es la base SIN `/v1` (`https://openrouter.ai/api`),
 * pero media internet publica la suya CON él (`https://api.groq.com/openai/v1`).
 * Se aceptan las dos: si ya termina en `/v1` no se duplica. Con la antigua
 * concatenación a ciegas, pegar la segunda daba `/v1/v1/chat/completions` y
 * un 404 que no explicaba nada.
 */
export function apiRoot(baseUrl: string): string {
  const sinBarra = baseUrl.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(sinBarra) ? sinBarra : `${sinBarra}/v1`;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  return `${apiRoot(baseUrl)}/models`;
}

/** Los últimos 4 del token: lo único que viaja a la UI. */
export function last4(token: string): string {
  return token.slice(-4);
}
