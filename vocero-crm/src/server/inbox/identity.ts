import { and, eq, or } from "drizzle-orm";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import type { WebhookMessage, WebhookValue } from "@/server/inbox/webhook";

/**
 * Identidad resiliente de contacto (003).
 *
 * Meta está migrando la identidad de WhatsApp de teléfono a Business-Scoped
 * User IDs (BSUID): `wa_id`/`from` pasan a ser opcionales y aparecen
 * `from_user_id` (mensaje) y `user_id` (contacts[]). Este módulo resuelve la
 * identidad del remitente sin asumir teléfono, y reconcilia para que un mismo
 * humano no genere dos contactos.
 */

export const BSUID_PREFIX = "bsuid:";
/** 014: identidad de Instagram, analoga al BSUID de WhatsApp. */
export const IG_PREFIX = "ig:";
/** 017: identidad de Messenger: el Page-Scoped ID (PSID) del remitente. */
export const FB_PREFIX = "fb:";
/** 022: identidad de TikTok: el id del remitente que entrega Zernio. */
export const TT_PREFIX = "tt:";

// El tipo vive en lib/ porque la interfaz tambien lo necesita; se reexporta
// aqui para no tocar a quien ya lo importaba de este modulo.
export type { Channel };

export type ResolvedIdentity = {
  /** Llave estable de resolución: teléfono normalizado o `bsuid:<id>`. */
  identity: string;
  /** 014: canal del contacto. Ausente = whatsapp (compatibilidad). */
  channel?: Channel;
  phone: string | null;
  waUserId: string | null;
  profileName: string | null;
};

/**
 * Extrae la identidad utilizable de un mensaje del webhook.
 * Devuelve null si el mensaje no trae NINGUNA identidad (se descarta con log,
 * jamás se revienta el webhook).
 */
export function resolveIdentity(
  msg: WebhookMessage,
  contacts: WebhookValue["contacts"]
): ResolvedIdentity | null {
  const waUserId =
    msg.from_user_id ??
    contacts?.find((c) => c.wa_id != null && c.wa_id === msg.from)?.user_id ??
    contacts?.find((c) => c.user_id != null)?.user_id ??
    null;

  const profileName =
    contacts?.find((c) => c.wa_id != null && c.wa_id === msg.from)?.profile
      ?.name ??
    (waUserId
      ? contacts?.find((c) => c.user_id === waUserId)?.profile?.name
      : undefined) ??
    null;

  if (msg.from) {
    const phone = normalizeMx(msg.from);
    return { identity: phone, phone, waUserId, profileName };
  }
  if (waUserId) {
    return {
      identity: `${BSUID_PREFIX}${waUserId}`,
      phone: null,
      waUserId,
      profileName,
    };
  }
  return null;
}

/**
 * El contacto de WhatsApp al que la ingesta asignaría esta identidad, SIN
 * crearlo: por `wa_identity`, por BSUID (en `wa_user_id` o como identidad
 * `bsuid:`) o por teléfono. Es LA regla de reconciliación: la usan la ingesta
 * y el cerebro externo, para que los dos hablen del mismo humano.
 */
export async function findWhatsappContact(
  organizationId: string,
  resolved: ResolvedIdentity
) {
  const matchers = [eq(schema.contact.waIdentity, resolved.identity)];
  if (resolved.waUserId) {
    matchers.push(eq(schema.contact.waUserId, resolved.waUserId));
    matchers.push(
      eq(schema.contact.waIdentity, `${BSUID_PREFIX}${resolved.waUserId}`)
    );
  }
  if (resolved.phone) {
    matchers.push(eq(schema.contact.phone, resolved.phone));
  }

  const rows = await getDb()
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.channel, "whatsapp"),
        or(...matchers)
      )
    )
    .orderBy(schema.contact.createdAt)
    .limit(1);
  return rows[0];
}

/**
 * La identidad que manda un cerebro externo, leída como la lee la ingesta:
 * `bsuid:<id>` es un BSUID y lo demás, un teléfono (normalizado igual que
 * `from`). Las de otros canales (`ig:`, `fb:`) no se reconcilian: null.
 */
export function parseIdentity(identity: string): ResolvedIdentity | null {
  if (
    identity.startsWith(IG_PREFIX) ||
    identity.startsWith(FB_PREFIX) ||
    identity.startsWith(TT_PREFIX)
  ) {
    return null;
  }
  if (identity.startsWith(BSUID_PREFIX)) {
    const waUserId = identity.slice(BSUID_PREFIX.length);
    if (!waUserId) return null;
    return { identity, phone: null, waUserId, profileName: null };
  }
  const phone = normalizeMx(identity);
  return { identity: phone, phone, waUserId: null, profileName: null };
}

/**
 * El contacto de una identidad para `/api/bot/*`. Primero la llave exacta (de
 * cualquier canal); si no existe, la reconciliación de la ingesta.
 *
 * El caso que la motiva: Meta migra a BSUID. Quien escribió primero CON
 * teléfono tiene `wa_identity` = teléfono (estable de por vida) y su BSUID en
 * `wa_user_id`; cuando después llega solo con BSUID, la ingesta lo reconcilia
 * a ese contacto, pero el cerebro pregunta por `bsuid:<id>` y recibía 404: el
 * cliente se quedaba sin respuesta.
 */
export async function findContactByIdentity(
  organizationId: string,
  identity: string
) {
  const rows = await getDb()
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.waIdentity, identity)
      )
    )
    .limit(1);
  if (rows[0]) return rows[0];
  const resolved = parseIdentity(identity);
  return resolved ? findWhatsappContact(organizationId, resolved) : undefined;
}

/**
 * Resuelve o crea el contacto para una identidad, reconciliando:
 * - Si llegan teléfono Y BSUID, encuentra al contacto por cualquiera de los
 *   dos y adquiere la señal que le faltaba (el `wa_identity` NO cambia:
 *   es estable de por vida).
 * - Reactiva contactos archivados (el nombre editado por el operador se
 *   respeta).
 */
export async function getOrCreateContactByIdentity(
  organizationId: string,
  resolved: ResolvedIdentity
) {
  const db = getDb();

  const channel: Channel = resolved.channel ?? "whatsapp";

  // 014/017: los canales de Meta (Instagram, Messenger) no comparten espacio
  // de identidades con WhatsApp. La reconciliacion telefono<->BSUID es
  // exclusiva de WhatsApp, asi que en ellos la busqueda es directa por
  // identidad dentro de su canal.
  if (channel !== "whatsapp") {
    const found = await db
      .select()
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.organizationId, organizationId),
          eq(schema.contact.channel, channel),
          eq(schema.contact.waIdentity, resolved.identity)
        )
      )
      .limit(1);
    const existingIg = found[0];
    if (existingIg) {
      if (existingIg.archivedAt) {
        await db
          .update(schema.contact)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(schema.contact.id, existingIg.id));
        existingIg.archivedAt = null;
      }
      return { contact: existingIg, isNew: false };
    }
    const createdIg = await db
      .insert(schema.contact)
      .values({
        id: newId("contact"),
        organizationId,
        channel,
        waIdentity: resolved.identity,
        phone: null,
        waUserId: null,
        name: resolved.profileName?.trim() || channelFallback(channel),
      })
      .onConflictDoNothing({
        target: [
          schema.contact.organizationId,
          schema.contact.channel,
          schema.contact.waIdentity,
        ],
      })
      .returning();
    if (createdIg[0]) return { contact: createdIg[0], isNew: true };
    const racedIg = await db
      .select()
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.organizationId, organizationId),
          eq(schema.contact.channel, channel),
          eq(schema.contact.waIdentity, resolved.identity)
        )
      )
      .limit(1);
    const contactIg = racedIg[0];
    if (!contactIg) throw new Error("contacto no encontrado tras upsert");
    return { contact: contactIg, isNew: false };
  }

  const existing = await findWhatsappContact(organizationId, resolved);
  if (existing) {
    const patch: Partial<typeof schema.contact.$inferInsert> = {};
    if (resolved.waUserId && !existing.waUserId)
      patch.waUserId = resolved.waUserId;
    if (resolved.phone && !existing.phone) patch.phone = resolved.phone;
    /**
     * El nombre del perfil se mantiene al dia (#51).
     *
     * Se actualizaba SOLO al crear el contacto, asi que quien cambiaba su
     * nombre de WhatsApp seguia apareciendo con el viejo para siempre.
     *
     * No se toca si lo escribio una persona: el operador que renombro a
     * alguien como "Juan - obra Polanco" no puede perder ese trabajo con el
     * siguiente mensaje. Esa es toda la razon de que exista `nameSource`.
     */
    const delPerfil = resolved.profileName?.trim();
    if (
      delPerfil &&
      existing.nameSource === "perfil" &&
      delPerfil !== existing.name
    ) {
      patch.name = delPerfil;
    }
    if (existing.archivedAt) patch.archivedAt = null;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      await db
        .update(schema.contact)
        .set(patch)
        .where(eq(schema.contact.id, existing.id));
      Object.assign(existing, patch);
    }
    return { contact: existing, isNew: false };
  }

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      waIdentity: resolved.identity,
      phone: resolved.phone,
      waUserId: resolved.waUserId,
      name: resolved.profileName?.trim() || displayFallback(resolved),
    })
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();
  if (inserted[0]) return { contact: inserted[0], isNew: true };

  // Carrera: otro request lo creó entre el SELECT y el INSERT.
  const raced = await db
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.waIdentity, resolved.identity)
      )
    )
    .limit(1);
  const contact = raced[0];
  if (!contact) throw new Error("contacto no encontrado tras upsert");
  return { contact, isNew: false };
}

/** Nombre de respaldo cuando no hay nombre de perfil: nunca el BSUID crudo. */
function displayFallback(resolved: ResolvedIdentity): string {
  if (resolved.phone) return resolved.phone;
  return "Contacto de WhatsApp";
}

/**
 * Respaldo para los canales cuyo webhook no trae nombre: nunca el IGSID ni el
 * PSID crudos, que en la bandeja no le dicen nada al operador.
 */
function channelFallback(channel: Channel): string {
  return `Contacto de ${CHANNEL_LABEL[channel] ?? channel}`;
}
