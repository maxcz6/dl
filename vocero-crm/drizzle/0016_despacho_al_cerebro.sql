CREATE TABLE "dispatch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp DEFAULT now() NOT NULL,
	"first_message_at" timestamp NOT NULL,
	"last_message_at" timestamp NOT NULL,
	"leased_until" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_conversation_vivo_uq" ON "dispatch" USING btree ("conversation_id") WHERE "dispatch"."status" in ('pendiente', 'en_vuelo');--> statement-breakpoint
CREATE INDEX "dispatch_org_status_updated_idx" ON "dispatch" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "dispatch_status_notbefore_idx" ON "dispatch" USING btree ("status","not_before");