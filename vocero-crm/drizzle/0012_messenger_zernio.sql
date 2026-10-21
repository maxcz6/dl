ALTER TABLE "messenger_credentials" ALTER COLUMN "page_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "account_ref" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN IF NOT EXISTS "webhook_secret" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messenger_credentials_account_ref_idx" ON "messenger_credentials" USING btree ("account_ref");
