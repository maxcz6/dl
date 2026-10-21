CREATE TABLE IF NOT EXISTS "instagram_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"ig_user_id" text NOT NULL,
	"account_ref" text,
	"username" text,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"webhook_secret" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "channel_thread_ref" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instagram_credentials" ADD CONSTRAINT "instagram_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "contact_org_wa_identity_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_org_channel_identity_uq" ON "contact" USING btree ("organization_id","channel","wa_identity");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_credentials_org_uq" ON "instagram_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_credentials_ig_user_uq" ON "instagram_credentials" USING btree ("ig_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instagram_credentials_account_ref_idx" ON "instagram_credentials" USING btree ("account_ref");
