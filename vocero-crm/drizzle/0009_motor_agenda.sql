-- 015 Motor de agendamiento universal (agenda, citas, memoria de lo ofrecido
-- y credenciales de los conectores).
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitución IV):
-- IF NOT EXISTS en tablas e índices, y DO-block en cada clave foránea.
--
-- Es puramente ADITIVA: no toca ninguna tabla existente, así que aplicarla
-- sobre una instancia con datos no puede perder nada. Se aplica SIEMPRE, con
-- la bandera AGENDA encendida o apagada: unas tablas vacías son inertes y a
-- cambio todas las instancias comparten la misma estructura (ADR-001).

CREATE TABLE IF NOT EXISTS "calendar_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_notice_hours" integer DEFAULT 2 NOT NULL,
	"max_days_ahead" integer DEFAULT 7 NOT NULL,
	"timezone" text DEFAULT 'America/Mexico_City' NOT NULL,
	"connector" text DEFAULT 'enlace-fijo' NOT NULL,
	"meeting_link" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'session' NOT NULL,
	"status" text DEFAULT 'agendada' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"contact_id" text,
	"conversation_id" text,
	"lead_id" text,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer NOT NULL,
	"connector" text,
	"external_ref" text,
	"meeting_link" text,
	"link_pending" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offered_slot" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"start_utc" timestamp NOT NULL,
	"label" text NOT NULL,
	"offered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zoom_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_cipher" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_cipher" text NOT NULL,
	"client_secret_iv" text NOT NULL,
	"client_secret_tag" text NOT NULL,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "booking" ADD CONSTRAINT "booking_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "booking" ADD CONSTRAINT "booking_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "booking" ADD CONSTRAINT "booking_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "booking" ADD CONSTRAINT "booking_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "offered_slot" ADD CONSTRAINT "offered_slot_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "zoom_credentials" ADD CONSTRAINT "zoom_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_settings_org_uq" ON "calendar_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_org_when_idx" ON "booking" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_org_status_idx" ON "booking" USING btree ("organization_id","status");--> statement-breakpoint

-- Anti doble-booking ATÓMICO: dos confirmaciones simultáneas sobre el mismo
-- instante no pueden ganar las dos; la perdedora recibe un 23505 que el
-- servicio traduce a `slot_taken` con alternativas frescas. Las citas de
-- prueba del Laboratorio quedan fuera: no consumen la agenda real.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_org_active_slot_uq" ON "booking" USING btree ("organization_id","scheduled_at") WHERE "booking"."status" in ('agendada','realizada') and "booking"."is_test" = false;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "offered_slot_conv_idx" ON "offered_slot" USING btree ("conversation_id","start_utc");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zoom_credentials_org_uq" ON "zoom_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_credentials_org_uq" ON "google_credentials" USING btree ("organization_id");
