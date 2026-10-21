import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { ImportRow } from "@/lib/contact-import";

/** Postgres admite ~65k parámetros por consulta; con margen de sobra. */
const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export type ImportResult = {
  /** Contactos nuevos. */
  created: number;
  /** Ya existían: no se duplican ni se les cambia el nombre. */
  existing: number;
  /** A cuántos se les apagó el agente (nuevos + existentes). */
  paused: number;
};

/**
 * 027 — Importa contactos de WhatsApp en lote. Re-ejecutable: importar dos veces el
 * mismo archivo no duplica a nadie.
 *
 * - NO crea conversación: un hilo vacío ensuciaría la Bandeja. La pausa del
 *   agente se guarda en el contacto y la conversación la hereda al nacer.
 * - NO crea lead: una lista importada (clientes, miembros) no es un embudo, y
 *   meterla al Pipeline lo llenaría de gente que no es prospecto.
 * - A quien ya existía se le respeta el nombre: pudo editarlo el dueño.
 * - El nombre del archivo lo escribió una persona: queda como `manual`, y el
 *   nombre de perfil de WhatsApp no lo pisa cuando el importado escriba. Un
 *   renglón sin nombre entra con el teléfono como nombre y `perfil`, para que
 *   el de WhatsApp lo reemplace en cuanto exista.
 */
export async function importContacts(
  organizationId: string,
  rows: ImportRow[],
  opts: { aiPaused: boolean }
): Promise<ImportResult> {
  const db = getDb();
  let created = 0;
  let existing = 0;
  let paused = 0;

  for (const batch of chunks(rows)) {
    const phones = batch.map((r) => r.phone);

    // Mismo criterio que la ingesta: alguien puede existir por identidad o por
    // teléfono (un contacto que llegó por BSUID y luego adquirió su número).
    const found = await db
      .select({
        id: schema.contact.id,
        waIdentity: schema.contact.waIdentity,
        phone: schema.contact.phone,
      })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          eq(schema.contact.channel, "whatsapp"),
          or(
            inArray(schema.contact.waIdentity, phones),
            inArray(schema.contact.phone, phones)
          )
        )
      );
    const known = new Set<string>();
    for (const c of found) {
      known.add(c.waIdentity);
      if (c.phone) known.add(c.phone);
    }
    const existingIds = found.map((c) => c.id);
    existing += batch.filter((r) => known.has(r.phone)).length;

    const fresh = batch.filter((r) => !known.has(r.phone));
    let insertedIds: string[] = [];
    if (fresh.length > 0) {
      const inserted = await db
        .insert(schema.contact)
        .values(
          fresh.map((r) => ({
            id: newId("contact"),
            organizationId,
            name: r.name,
            nameSource: r.name === r.phone ? ("perfil" as const) : ("manual" as const),
            phone: r.phone,
            waIdentity: r.phone,
            aiPaused: opts.aiPaused,
          }))
        )
        .onConflictDoNothing({
          target: [
            schema.contact.organizationId,
            schema.contact.channel,
            schema.contact.waIdentity,
          ],
        })
        .returning({ id: schema.contact.id });
      insertedIds = inserted.map((c) => c.id);
      created += insertedIds.length;
      // Carrera con la ingesta: alguien escribió entre el SELECT y el INSERT.
      existing += fresh.length - insertedIds.length;
    }

    if (!opts.aiPaused) continue;
    paused += insertedIds.length;

    if (existingIds.length > 0) {
      await db
        .update(schema.contact)
        .set({ aiPaused: true, updatedAt: new Date() })
        .where(
          scoped(
            schema.contact.organizationId,
            organizationId,
            inArray(schema.contact.id, existingIds)
          )
        );
      paused += existingIds.length;
      await pauseConversations(organizationId, existingIds, true);
    }
  }

  return { created, existing, paused };
}

/**
 * Lleva la pausa del contacto a su conversación real, si ya existe.
 *
 * Sin esto, apagar el agente a alguien con quien ya se está hablando no
 * tendría efecto hasta que su conversación se borrara y naciera otra.
 * Reanudar NO toca `handoff_at`: una escalada que el agente decidió se levanta
 * desde la Bandeja, donde se ve por qué ocurrió.
 */
export async function pauseConversations(
  organizationId: string,
  contactIds: string[],
  paused: boolean
): Promise<void> {
  if (contactIds.length === 0) return;
  await getDb()
    .update(schema.conversation)
    .set({ aiEnabled: !paused, updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        inArray(schema.conversation.contactId, contactIds),
        eq(schema.conversation.isTest, false)
      )
    );
}
