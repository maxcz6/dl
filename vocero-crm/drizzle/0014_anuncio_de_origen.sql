-- 018 - De que anuncio llego cada conversacion: la imagen del creativo.
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en columna e indice, y bloque DO en la clave foranea.
--
-- Puramente ADITIVA: una columna nula y un indice sobre ad_attribution (016).
-- Las filas que ya existen quedan sin imagen; la app la repara al abrir el
-- contacto con la URL que ya guarda su raw, mientras Meta no la caduque.
--
-- Mismos nombres de columna, clave foranea e indice que la 0023 de Vocero
-- Cloud (spec 212): los dos repos comparten la forma de la tabla.

ALTER TABLE "ad_attribution" ADD COLUMN IF NOT EXISTS "image_asset_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_image_asset_id_media_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_attribution_org_source_idx" ON "ad_attribution" USING btree ("organization_id","source_id");
