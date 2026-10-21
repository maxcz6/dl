import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import type { Channel } from "@/lib/channels";
import { capabilitiesFor } from "@/server/channels/capabilities";

/**
 * 022 — El tope de mensajes de un canal.
 *
 * TikTok acepta hasta 10 mensajes después del último mensaje del cliente, y
 * el undécimo falla con un error de la plataforma que no dice gran cosa. Se
 * cuenta aquí, antes de llamar a nadie, para rechazarlo con un motivo que el
 * operador entienda y un código que un cerebro pueda tratar.
 *
 * No es un límite de velocidad: no se recupera esperando, solo cuando el
 * cliente vuelve a escribir.
 */

/** Pura: ¿cabe un mensaje más? Un canal sin tope siempre dice que sí. */
export function cabeOtroMensaje(channel: Channel, enviados: number): boolean {
  const tope = capabilitiesFor(channel).maxOutboundPerWindow;
  return tope === null || enviados < tope;
}

/**
 * Cuántos mensajes salieron en la conversación desde el último entrante.
 *
 * Cuenta lo que salió de verdad —de una persona o del agente—; un envío
 * fallido no gastó nada en la plataforma. La comparación de horas se hace en
 * Postgres, que guarda microsegundos.
 */
export async function salientesDesdeElUltimoEntrante(
  organizationId: string,
  conversationId: string
): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n
    from message m
    where m.organization_id = ${organizationId}
      and m.conversation_id = ${conversationId}
      and m.direction = 'out'
      and m.status <> 'failed'
      and m.created_at > coalesce((
        select max(e.created_at) from message e
        where e.organization_id = ${organizationId}
          and e.conversation_id = ${conversationId}
          and e.direction = 'in'
      ), '-infinity'::timestamp)
  `);
  return Number(rows[0]?.n ?? 0);
}
