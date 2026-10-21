import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { serializeFicha } from "@/server/bot/ficha";
import { findContactByIdentity } from "@/server/inbox/identity";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import { windowMsFor } from "@/server/channels/capabilities";
import { citasParaContexto } from "@/server/agenda/context";
import { anuncioDelContacto } from "@/server/attribution/store";
import { siguientesDelLead } from "@/server/bot/stage";

export const dynamic = "force-dynamic";

/**
 * Contexto conversacional para un cerebro externo (solo lectura).
 * GET /api/bot/context?identity=... | ?waIdentity=... | ?conversationId=...
 *
 * `identity` es el nombre neutro (hay contactos que no son de WhatsApp).
 * `waIdentity` se mantiene aceptado y presente en la respuesta porque es
 * contrato publicado: hay cerebros externos en produccion que dependen de el.
 * No tiene fecha de retiro.
 *
 * NO devuelve el historial de mensajes: el bot lleva su propia memoria de la
 * conversación. Lo que aquí sale es lo que solo el CRM sabe — quién es la
 * persona, si un humano tomó el control y si la ventana de 24 h sigue abierta
 * (y, con la agenda encendida, qué citas tiene: `booking`).
 *
 * 031 — `adOrigen`: de qué anuncio llegó la persona, o `null`. Antes un
 * cerebro delante del CRM lo leía del `referral` del webhook de Meta; con el
 * despacho el webhook ya no le llega, y esto es lo que lo reemplaza. Misma
 * llave y misma forma que en Vocero Cloud. El `ctwa_clid` no sale: solo si
 * existe.
 *
 * 038 — `lead.nextStages`: a qué etapas puede mover el cerebro al lead con
 * `POST /api/bot/stage` (las abiertas después de la actual, en orden). Va
 * aquí y no en el perfil porque depende de la etapa de este momento.
 */
export async function GET(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const url = new URL(req.url);
  const waIdentity =
    url.searchParams.get("identity") ?? url.searchParams.get("waIdentity");
  const conversationId = url.searchParams.get("conversationId");
  if (!waIdentity && !conversationId) {
    return apiError(422, "invalid", "Falta identity (o waIdentity) o conversationId");
  }

  const db = getDb();

  let contact: typeof schema.contact.$inferSelect | undefined;
  let conversation: typeof schema.conversation.$inferSelect | undefined;

  if (conversationId) {
    const rows = await db
      .select({ conversation: schema.conversation, contact: schema.contact })
      .from(schema.conversation)
      .innerJoin(
        schema.contact,
        eq(schema.conversation.contactId, schema.contact.id)
      )
      .where(
        and(
          eq(schema.conversation.organizationId, organizationId),
          eq(schema.conversation.id, conversationId)
        )
      )
      .limit(1);
    contact = rows[0]?.contact;
    conversation = rows[0]?.conversation;
  } else if (waIdentity) {
    // Exacta primero; si no, la reconciliación de la ingesta (R11): quien
    // escribió con teléfono y ahora llega solo con BSUID es el mismo contacto.
    contact = await findContactByIdentity(organizationId, waIdentity);
    if (contact) {
      // La conversación del Laboratorio jamás se resuelve por identidad: ese
      // camino es para el bot de producción, que nunca debe hablarle a un
      // cliente simulado.
      const convs = await db
        .select()
        .from(schema.conversation)
        .where(
          and(
            eq(schema.conversation.organizationId, organizationId),
            eq(schema.conversation.contactId, contact.id),
            eq(schema.conversation.isTest, false)
          )
        )
        .limit(1);
      conversation = convs[0];
    }
  }

  if (!contact || !conversation) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }

  const [leadRows, booking, anuncio] = await Promise.all([
    db
      .select({ lead: schema.lead, stage: schema.pipelineStage })
      .from(schema.lead)
      .innerJoin(
        schema.pipelineStage,
        eq(schema.lead.stageId, schema.pipelineStage.id)
      )
      .where(
        and(
          eq(schema.lead.organizationId, organizationId),
          eq(schema.lead.contactId, contact.id)
        )
      )
      .limit(1),
    citasParaContexto(organizationId, contact.id),
    anuncioDelContacto(organizationId, contact.id),
  ]);
  const nextStages = leadRows[0]
    ? await siguientesDelLead(organizationId, leadRows[0].lead.stageId)
    : [];

  return Response.json({
    contact: {
      id: contact.id,
      name: contact.name,
      /** Nombre neutro (014). Preferir este en clientes nuevos. */
      identity: contact.waIdentity,
      /** Alias heredado: sigue aqui para no romper bots ya desplegados. */
      waIdentity: contact.waIdentity,
      channel: contact.channel,
      phone: contact.phone,
      ficha: serializeFicha(contact),
    },
    conversation: {
      id: conversation.id,
      // Una sola verdad para el bot: si hay handoff, la IA está apagada
      // aunque el flag siga en true.
      aiEnabled: conversation.aiEnabled && !conversation.handoffAt,
      handoffAt: conversation.handoffAt?.toISOString() ?? null,
      // 022: la ventana es la del canal de la conversación.
      windowOpen: isWindowOpen(
        conversation.lastInboundAt,
        new Date(),
        windowMsFor(conversation.channel)
      ),
      windowRemainingMs: windowRemainingMs(
        conversation.lastInboundAt,
        new Date(),
        windowMsFor(conversation.channel)
      ),
    },
    lead: leadRows[0]
      ? { id: leadRows[0].lead.id, stageName: leadRows[0].stage.name, nextStages }
      : null,
    adOrigen: anuncio
      ? {
          headline: anuncio.headline,
          body: anuncio.body,
          sourceType: anuncio.sourceType,
          sourceUrl: anuncio.sourceUrl,
          hasCtwaClid: anuncio.hasCtwaClid,
          capturedAt: anuncio.capturedAt,
        }
      : null,
    /**
     * 015 — Las citas del contacto. FALTA con la agenda apagada (o si no se
     * pudieron leer): un cerebro que no lo recibe no afirma nada sobre citas,
     * y uno que no lo lee no cambia. Aditivo.
     */
    ...(booking ? { booking } : {}),
  });
}
