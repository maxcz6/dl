CREATE TABLE "media_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"wa_media_id" text,
	"mime_type" text,
	"file_name" text,
	"file_size" integer,
	"caption" text,
	"payload" jsonb,
	"storage_path" text,
	"fetch_status" text DEFAULT 'pending' NOT NULL,
	"fetch_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "origin" text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "media_asset_id" text;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_asset_org_idx" ON "media_asset" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "media_asset_wa_media_idx" ON "media_asset" USING btree ("wa_media_id");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_media_asset_id_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "message" SET "origin" = 'ai' WHERE "direction" = 'out' AND "ai_generated" = true AND "origin" = 'operator';--> statement-breakpoint
UPDATE "message" SET "origin" = 'template' WHERE "direction" = 'out' AND "type" = 'template' AND "origin" = 'operator';
