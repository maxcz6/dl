import type { TiktokCredentials } from "@/server/tiktok/credentials";
import { sendZernioMessage } from "@/server/zernio";

/**
 * 022 — Frontera de salida del canal de TikTok (Constitución II: todo request
 * a una plataforma pasa por un único módulo).
 *
 * Un solo transporte: Zernio, que responde DENTRO de su conversación con el
 * `conversationId` opaco que guardó la ingesta. TikTok no deja que el negocio
 * inicie, así que una conversación sin esa referencia no tiene a dónde ir.
 *
 * La ventana de 48 horas y el tope de mensajes se comprueban antes, en
 * `prepareSend` (`src/server/inbox/send.ts`): aquí ya solo se envía.
 */

export type TiktokSendResult = { platformMessageId: string };

export async function sendTiktokText(input: {
  credentials: TiktokCredentials;
  threadRef: string | null;
  text: string;
}): Promise<TiktokSendResult> {
  return sendZernioMessage({
    token: input.credentials.token,
    accountId: input.credentials.accountRef,
    conversationId: input.threadRef,
    text: input.text,
  });
}
