-- 016 Atribucion de anuncios Click-to-WhatsApp y Conversions API de Meta
-- (origen del anuncio, eventos reportados y la conexion del negocio).
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas e indices, y DO-block en cada clave foranea.
--
-- Es puramente ADITIVA: no toca ninguna tabla existente, asi que aplicarla
-- sobre una instancia con datos no puede perder nada. Se aplica SIEMPRE, con
-- la bandera ATRIBUCION encendida o apagada: unas tablas vacias son inertes y
-- a cambio todas las instancias comparten la misma estructura (ADR-001).

CREATE TABLE IF NOT EXISTS "ad_attribution" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"ctwa_clid" text,
	"source_id" text,
	"source_type" text,
	"source_url" text,
	"headline" text,
	"body" text,
	"media_type" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "capi_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"qualified_stage_id" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversion_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"attribution_id" text,
	"event_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"fb_trace_id" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ad_attribution" ADD CONSTRAINT "ad_attribution_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_qualified_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("qualified_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversion_event" ADD CONSTRAINT "conversion_event_attribution_id_ad_attribution_id_fk" FOREIGN KEY ("attribution_id") REFERENCES "public"."ad_attribution"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_attribution_org_conversation_uq" ON "ad_attribution" USING btree ("organization_id","conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_attribution_org_contact_idx" ON "ad_attribution" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capi_settings_org_uq" ON "capi_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_event_org_conv_name_uq" ON "conversion_event" USING btree ("organization_id","conversation_id","event_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversion_event_org_created_idx" ON "conversion_event" USING btree ("organization_id","created_at");
