CREATE TABLE "trip_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"prior_trip_id" uuid NOT NULL,
	"next_trip_id" uuid NOT NULL,
	"resolution" text DEFAULT 'BOBTAIL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_gaps" ADD CONSTRAINT "trip_gaps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_gaps" ADD CONSTRAINT "trip_gaps_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_gaps" ADD CONSTRAINT "trip_gaps_prior_trip_id_trips_id_fk" FOREIGN KEY ("prior_trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_gaps" ADD CONSTRAINT "trip_gaps_next_trip_id_trips_id_fk" FOREIGN KEY ("next_trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_gaps_pair_key" ON "trip_gaps" USING btree ("prior_trip_id","next_trip_id");--> statement-breakpoint
CREATE INDEX "trip_gaps_driver_idx" ON "trip_gaps" USING btree ("driver_id");
