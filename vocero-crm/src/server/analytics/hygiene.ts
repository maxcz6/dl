import { and, asc, desc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { sumable } from "@/lib/money";
import type { HygieneBlockDto } from "@/lib/analytics";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 019 — Bloque de higiene.
 *
 * NO es análisis histórico: describe el AHORA, y por eso no toma rango de
 * fechas. Es lo que hace que la pantalla se abra a diario en vez de una vez al
 * mes.
 */

/** Días sin que hable el cliente a partir de los cuales el lead está frío. */
export const SILENCIO_DIAS = 7;
/** Cuántos leads en silencio se listan; el total viaja aparte. */
export const MAX_SILENCIOSOS = 50;

export async function hygieneBlock(
  organizationId: string,
  businessCurrency: string,
  now: Date = new Date()
): Promise<HygieneBlockDto> {
  const [silencio, failedMessages, closingWindows] = await Promise.all([
    leadsEnSilencio(organizationId, businessCurrency, now),
    mensajesFallidos(organizationId, now),
    ventanasPorVencer(organizationId, now),
  ]);

  return {
    silent: silencio.lista,
    silentCount: silencio.total,
    silentAmountCents: silencio.totalCents,
    failedMessages,
    closingWindows,
    clean:
      silencio.total === 0 &&
      failedMessages.length === 0 &&
      closingWindows.length === 0,
  };
}

/**
 * Leads abiertos sin respuesta del cliente en más de una semana, con el dinero
 * que se está enfriando.
 *
 * El silencio se mide por la última vez que habló EL CLIENTE, no por la última
 * vez que pasó algo: mandarle tres seguimientos a un lead muerto lo haría ver
 * "activo" justo cuando más atención necesita.
 *
 * El total y el dinero salen de funciones de ventana, que se calculan ANTES
 * del límite: la lista se corta en 50, los números no.
 */
async function leadsEnSilencio(organizationId: string, businessCurrency: string, now: Date) {
  const corte = new Date(now.getTime() - SILENCIO_DIAS * 86_400_000);
  // `mapWith`: un timestamp en SQL crudo llega como texto SIN zona, y
  // `new Date()` lo leería en la hora local del servidor. El mapeador de la
  // columna lo lee como UTC, que es lo que guarda.
  const ultimo = sql<Date>`coalesce(${schema.conversation.lastInboundAt}, ${schema.lead.lastActivityAt}, ${schema.lead.createdAt})`.mapWith(
    schema.lead.createdAt
  );

  const rows = await getDb()
    .select({
      leadId: schema.lead.id,
      contactId: schema.contact.id,
      name: schema.contact.name,
      amountCents: schema.lead.amountCents,
      currency: schema.lead.currency,
      ultimo,
      total: sql<number>`(count(*) over ())::int`,
      totalCents: sql<string>`coalesce(sum(case when ${schema.lead.amountCents} is not null and coalesce(${schema.lead.currency}, ${businessCurrency}) = ${businessCurrency} then ${schema.lead.amountCents} end) over (), 0)::bigint`,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.lead.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.pipelineStage.kind, "open"),
        isNull(schema.contact.archivedAt),
        notLabContact(schema.lead.contactId),
        // El instante va como texto con cast explícito: dentro de un
        // `coalesce` el tipo del parámetro es desconocido y el driver no sabe
        // serializar un Date contra "unknown".
        sql`${ultimo} < ${corte.toISOString()}::timestamp`
      )
    )
    // Lo más frío primero: si hay más de 50, se ven los que más urge rescatar.
    .orderBy(asc(ultimo))
    .limit(MAX_SILENCIOSOS);

  const lista = rows
    .map((r) => ({
      leadId: r.leadId,
      contactId: r.contactId,
      name: r.name,
      days: Math.floor((now.getTime() - r.ultimo.getTime()) / 86_400_000),
      // Solo el dinero en la moneda del negocio entra en el total en riesgo.
      amountCents: sumable({ amountCents: r.amountCents, currency: r.currency }, businessCurrency)
        ? r.amountCents
        : null,
    }))
    .sort((a, b) => (b.amountCents ?? 0) - (a.amountCents ?? 0) || b.days - a.days);

  return {
    lista,
    total: rows[0]?.total ?? 0,
    totalCents: Number(rows[0]?.totalCents ?? 0),
  };
}

/** Salientes que no llegaron en los últimos 30 días, por motivo. */
async function mensajesFallidos(organizationId: string, now: Date) {
  const desde = new Date(now.getTime() - 30 * 86_400_000);

  const rows = await getDb()
    .select({
      error: schema.message.error,
      n: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${schema.message.createdAt})`.mapWith(schema.message.createdAt),
    })
    .from(schema.message)
    // El Laboratorio no manda nada a Meta, pero si algo suyo quedara fallido
    // no es un mensaje que el negocio haya perdido.
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.conversation.id, schema.message.conversationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.status, "failed"),
        gt(schema.message.createdAt, desde)
      )
    )
    .groupBy(schema.message.error)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return rows.map((r) => ({
    error: r.error ?? "Sin detalle",
    count: r.n,
    lastAt: r.lastAt.toISOString(),
  }));
}

/**
 * Conversaciones donde la ventana de 24 h está por cerrarse y el negocio aún
 * no ha contestado.
 *
 * Pasada esa ventana solo se puede escribir con plantilla: es la diferencia
 * entre responder gratis y gastar una.
 */
async function ventanasPorVencer(organizationId: string, now: Date) {
  const limite = new Date(now.getTime() - 20 * 3_600_000);
  const vencida = new Date(now.getTime() - 24 * 3_600_000);

  const rows = await getDb()
    .select({
      conversationId: schema.conversation.id,
      contactId: schema.conversation.contactId,
      name: schema.contact.name,
      lastInboundAt: schema.conversation.lastInboundAt,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        isNotNull(schema.conversation.lastInboundAt),
        lt(schema.conversation.lastInboundAt, limite),
        gt(schema.conversation.lastInboundAt, vencida),
        // Sin respuesta nuestra posterior a lo último que dijo el cliente.
        sql`(${schema.conversation.lastMessageAt} is null or ${schema.conversation.lastMessageAt} <= ${schema.conversation.lastInboundAt})`
      )
    )
    // La que se cierra primero, arriba.
    .orderBy(asc(schema.conversation.lastInboundAt))
    .limit(20);

  return rows.map((r) => ({
    conversationId: r.conversationId,
    contactId: r.contactId,
    name: r.name,
    hoursLeft:
      Math.round(
        ((r.lastInboundAt!.getTime() + 24 * 3_600_000 - now.getTime()) / 3_600_000) * 10
      ) / 10,
  }));
}
