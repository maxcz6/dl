-- 003 Identidad resiliente de contacto (BSUID).
-- Editada a mano sobre la generada: añade backfill + dedup para instancias con
-- datos (en una instancia fresca los pasos de backfill son no-op). Corre en una
-- transacción (migrator de drizzle), re-ejecutable vía IF EXISTS/IF NOT EXISTS.

ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_identity" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_user_id" text;--> statement-breakpoint

-- Backfill: la identidad es el teléfono NORMALIZADO (troncal MX 521→52) — la
-- misma regla que normalizeMx() en src/lib/meta/client.ts.
UPDATE "contact"
SET "wa_identity" = CASE
  WHEN "phone" ~ '^521[0-9]{10}$' THEN '52' || substring("phone" from 4)
  ELSE "phone"
END
WHERE "wa_identity" IS NULL;--> statement-breakpoint

-- Dedup de colisiones post-normalización (contactos 521/52 duplicados hoy):
-- la fila más antigua es canónica; se re-apunta lo colgado y se borra la dup.
CREATE TEMPORARY TABLE "_contact_dedup" ON COMMIT DROP AS
SELECT id AS dup_id, keep_id FROM (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY organization_id, wa_identity
           ORDER BY created_at, id
         ) AS keep_id
  FROM "contact"
) ranked
WHERE id <> keep_id;--> statement-breakpoint

-- Conversaciones no-test del duplicado cuando la canónica YA tiene una:
-- mover los mensajes a la conversación canónica y borrar la duplicada.
UPDATE "message" m
SET conversation_id = ck.id
FROM "conversation" cd
JOIN "_contact_dedup" d ON cd.contact_id = d.dup_id
JOIN "conversation" ck ON ck.contact_id = d.keep_id AND ck.is_test = false
WHERE m.conversation_id = cd.id AND cd.is_test = false;--> statement-breakpoint

DELETE FROM "conversation" cd
USING "_contact_dedup" d, "conversation" ck
WHERE cd.contact_id = d.dup_id AND cd.is_test = false
  AND ck.contact_id = d.keep_id AND ck.is_test = false;--> statement-breakpoint

-- Resto de conversaciones del duplicado (canónica sin conversación, o de test):
-- re-apuntar a la canónica.
UPDATE "conversation" cd
SET contact_id = d.keep_id
FROM "_contact_dedup" d
WHERE cd.contact_id = d.dup_id;--> statement-breakpoint

-- Leads: si ambas filas tienen lead, sobrevive el de la canónica.
DELETE FROM "lead" l
USING "_contact_dedup" d, "lead" lk
WHERE l.contact_id = d.dup_id AND lk.contact_id = d.keep_id;--> statement-breakpoint

UPDATE "lead" l
SET contact_id = d.keep_id
FROM "_contact_dedup" d
WHERE l.contact_id = d.dup_id;--> statement-breakpoint

DELETE FROM "contact" c
USING "_contact_dedup" d
WHERE c.id = d.dup_id;--> statement-breakpoint

ALTER TABLE "contact" ALTER COLUMN "wa_identity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "contact_org_phone_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_org_wa_identity_uq" ON "contact" USING btree ("organization_id","wa_identity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_wa_user_id_idx" ON "contact" USING btree ("organization_id","wa_user_id");
