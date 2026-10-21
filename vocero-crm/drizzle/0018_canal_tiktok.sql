CREATE TABLE "tiktok_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text DEFAULT 'zernio' NOT NULL,
	"account_ref" text NOT NULL,
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
ALTER TABLE "tiktok_credentials" ADD CONSTRAINT "tiktok_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_credentials_org_uq" ON "tiktok_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_credentials_account_ref_uq" ON "tiktok_credentials" USING btree ("account_ref");