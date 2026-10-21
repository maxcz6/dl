ALTER TABLE "agent_profile" ADD COLUMN "role" text DEFAULT 'calificador' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "tools" jsonb;