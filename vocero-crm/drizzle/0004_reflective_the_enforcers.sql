CREATE TABLE "lead_stage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"from_stage_id" text,
	"from_stage_name" text,
	"to_stage_id" text,
	"to_stage_name" text NOT NULL,
	"to_stage_kind" text DEFAULT 'open' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"source" text DEFAULT 'dueno' NOT NULL,
	"approximate" boolean DEFAULT false NOT NULL,
	"loss_reason" text,
	"loss_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lse_loss_reason_ck" CHECK ("lead_stage_event"."to_stage_kind" <> 'lost' OR "lead_stage_event"."approximate" = true OR "lead_stage_event"."loss_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_from_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_to_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_stage_event" ADD CONSTRAINT "lead_stage_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lse_org_occurred_idx" ON "lead_stage_event" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lse_lead_occurred_idx" ON "lead_stage_event" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lse_org_kind_occurred_idx" ON "lead_stage_event" USING btree ("organization_id","to_stage_kind","occurred_at");--> statement-breakpoint
-- Siembra de la bitácora para los leads que ya existían.
-- El pasado NO se reconstruye: se marca `approximate = true` para que estos
-- eventos cuenten en los TOTALES pero nunca en los promedios de tiempo.
-- Idempotente: el id se deriva del lead con md5, así que re-ejecutar la
-- migración no duplica.
--
-- 1) "Nació aquí": todo lead entra por la primera etapa del tablero, que es
--    exactamente donde lo pone la ingesta. La fecha SÍ es confiable
--    (`created_at` no se pisa).
INSERT INTO "lead_stage_event" (
  "id","organization_id","lead_id","contact_id",
  "from_stage_id","from_stage_name","to_stage_id","to_stage_name","to_stage_kind",
  "occurred_at","actor_user_id","source","approximate","created_at"
)
SELECT
  'lse_' || substr(md5(l."id" || ':nacio'), 1, 20),
  l."organization_id", l."id", l."contact_id",
  NULL, NULL,
  primera."id", primera."name", primera."kind",
  l."created_at", NULL, 'migracion', true, now()
FROM "lead" l
CROSS JOIN LATERAL (
  SELECT s."id", s."name", s."kind"
  FROM "pipeline_stage" s
  WHERE s."organization_id" = l."organization_id"
  ORDER BY s."position" ASC
  LIMIT 1
) AS primera
WHERE NOT EXISTS (
  SELECT 1 FROM "lead_stage_event" e
  WHERE e."id" = 'lse_' || substr(md5(l."id" || ':nacio'), 1, 20)
);--> statement-breakpoint
-- 2) "Llegó hasta aquí": un segundo evento hacia la etapa ACTUAL para los
--    leads que ya no están en la primera. Sin él, el embudo diría que ningún
--    lead viejo pasó de la primera columna. La fecha es `updated_at`, que
--    cualquier edición pisa: por eso va como aproximada.
INSERT INTO "lead_stage_event" (
  "id","organization_id","lead_id","contact_id",
  "from_stage_id","from_stage_name","to_stage_id","to_stage_name","to_stage_kind",
  "occurred_at","actor_user_id","source","approximate","created_at"
)
SELECT
  'lse_' || substr(md5(l."id" || ':actual'), 1, 20),
  l."organization_id", l."id", l."contact_id",
  primera."id", primera."name",
  actual."id", actual."name", actual."kind",
  GREATEST(l."updated_at", l."created_at"), NULL, 'migracion', true, now()
FROM "lead" l
JOIN "pipeline_stage" actual ON actual."id" = l."stage_id"
CROSS JOIN LATERAL (
  SELECT s."id", s."name"
  FROM "pipeline_stage" s
  WHERE s."organization_id" = l."organization_id"
  ORDER BY s."position" ASC
  LIMIT 1
) AS primera
WHERE actual."id" <> primera."id"
AND NOT EXISTS (
  SELECT 1 FROM "lead_stage_event" e
  WHERE e."id" = 'lse_' || substr(md5(l."id" || ':actual'), 1, 20)
);
