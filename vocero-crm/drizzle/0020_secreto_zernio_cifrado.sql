ALTER TABLE "instagram_credentials" ADD COLUMN "webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN "webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "instagram_credentials" ADD COLUMN "webhook_secret_tag" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN "webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN "webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "messenger_credentials" ADD COLUMN "webhook_secret_tag" text;--> statement-breakpoint
ALTER TABLE "tiktok_credentials" ADD COLUMN "webhook_secret_cipher" text;--> statement-breakpoint
ALTER TABLE "tiktok_credentials" ADD COLUMN "webhook_secret_iv" text;--> statement-breakpoint
ALTER TABLE "tiktok_credentials" ADD COLUMN "webhook_secret_tag" text;