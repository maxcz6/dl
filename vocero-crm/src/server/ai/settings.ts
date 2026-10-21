import { z } from "zod";
import {
  AI_PROVIDERS,
  AI_PROVIDER_PRESETS,
  last4,
  type AiProviderId,
} from "@/lib/ai/presets";
import {
  envAiProvider,
  estadoIaDe,
  mensajeDeEstado,
  type EstadoIa,
} from "@/lib/ai/provider";
import {
  getAiCredentialPublic,
  getAiCredentialSecret,
  type AiCredentialPublic,
} from "@/server/ai/credentials";

/**
 * Ajustes → IA: lo que valida y lo que devuelve `/api/settings/ai`. Fuera del
 * `route.ts` para poder probarlo sin sesión.
 */

const baseUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "La base URL debe empezar por http:// o https://",
  });

/**
 * El mínimo de la llave es laxo a propósito: el formato lo decide el proveedor
 * y cambia sin avisar. Quien manda sobre si sirve es el proveedor al usarla
 * («Probar conexión»).
 */
const tokenSchema = z.string().trim().min(8).max(4096);

const modelSchema = z.string().trim().min(1).max(200);

const conProveedor = {
  // Sin `.default()`: con él, `parseBody` infiere el tipo de ENTRADA (con
  // `undefined`) y el handler pierde el tipado. La UI siempre lo manda.
  provider: z.enum(AI_PROVIDERS),
  /** Obligatoria con «Otro compatible con OpenAI»; con OpenRouter se ignora. */
  baseUrl: baseUrlSchema.optional(),
};

function exigeBaseUrl(
  data: { provider: AiProviderId; baseUrl?: string },
  ctx: z.RefinementCtx
) {
  if (data.provider === "openai_compatible" && !data.baseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseUrl"],
      message: "Con «Otro compatible con OpenAI» hay que indicar la base URL",
    });
  }
}

/** `PUT /api/settings/ai`: sin `token` solo cambia proveedor/modelo. */
export const aiSettingsPutSchema = z
  .object({
    ...conProveedor,
    model: modelSchema,
    token: tokenSchema.optional(),
  })
  .superRefine(exigeBaseUrl);

/** `POST /api/settings/ai/test`: sin `token` se prueba la llave guardada. */
export const aiProbeSchema = z
  .object({
    ...conProveedor,
    model: modelSchema,
    token: tokenSchema.optional(),
  })
  .superRefine(exigeBaseUrl);

/** `POST /api/settings/ai/models`: sin `token` se usa la llave guardada. */
export const aiModelsSchema = z
  .object({
    ...conProveedor,
    token: tokenSchema.optional(),
  })
  .superRefine(exigeBaseUrl);

/** La base URL que de verdad se usa: la del preset, o la escrita. */
export function baseUrlEfectiva(
  provider: AiProviderId,
  baseUrl: string | undefined
): string {
  const preset = AI_PROVIDER_PRESETS[provider].baseUrl;
  if (preset) return preset;
  // El esquema ya exigió la base URL para este preset; el fallback solo
  // calma al tipado.
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

/**
 * La llave con la que probar o listar: la escrita, o la guardada. `null` si
 * no hay ninguna de las dos.
 */
export async function llaveParaProbar(
  organizationId: string,
  escrita: string | undefined
): Promise<{ token: string; guardada: boolean } | null> {
  if (escrita) return { token: escrita, guardada: false };
  const cred = await getAiCredentialSecret(organizationId);
  return cred ? { token: cred.token, guardada: true } : null;
}

export type AiSettingsView = {
  credencial: {
    proveedor: AiProviderId;
    baseUrl: string;
    modelo: string;
    tokenLast4: string;
    estado: AiCredentialPublic["status"];
    motivo: string | null;
    desde: string | null;
    actualizado: string;
  } | null;
  /** Lo que resuelve el adaptador ahora mismo (fila, y si no, entorno). */
  activa: boolean;
  origen: "org" | "env" | null;
  mensaje: string | null;
  /** Las variables `OPENROUTER_*`, si están: el respaldo. */
  respaldoEntorno: { baseUrl: string; modelo: string; tokenLast4: string } | null;
};

export function credencialVista(
  cred: AiCredentialPublic | null
): AiSettingsView["credencial"] {
  if (!cred) return null;
  return {
    proveedor: cred.provider,
    baseUrl: cred.baseUrl,
    modelo: cred.model,
    tokenLast4: cred.tokenLast4,
    estado: cred.status,
    motivo: cred.statusReason,
    desde: cred.statusChangedAt?.toISOString() ?? null,
    actualizado: cred.updatedAt.toISOString(),
  };
}

export async function vistaAjustesIa(
  organizationId: string
): Promise<AiSettingsView> {
  const [cred, estado] = await Promise.all([
    getAiCredentialPublic(organizationId),
    estadoIaDe(organizationId),
  ]);
  return armarVista(cred, estado);
}

/** Pura, para las pruebas. */
export function armarVista(
  cred: AiCredentialPublic | null,
  estado: EstadoIa
): AiSettingsView {
  const env = envAiProvider();
  return {
    credencial: credencialVista(cred),
    activa: estado.activa,
    origen: estado.activa ? estado.origen : null,
    mensaje: mensajeDeEstado(estado),
    respaldoEntorno: env
      ? { baseUrl: env.baseUrl, modelo: env.model, tokenLast4: last4(env.token) }
      : null,
  };
}
