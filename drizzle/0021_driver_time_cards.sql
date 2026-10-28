CREATE TABLE "driver_time_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"header" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"header_overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_time_cards" ADD CONSTRAINT "driver_time_cards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "driver_time_cards" ADD CONSTRAINT "driver_time_cards_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "driver_time_cards_driver_date_key" ON "driver_time_cards" USING btree ("driver_id","work_date");
--> statement-breakpoint
CREATE INDEX "driver_time_cards_company_idx" ON "driver_time_cards" USING btree ("company_id","work_date");
