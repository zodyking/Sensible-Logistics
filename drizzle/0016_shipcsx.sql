ALTER TABLE "locations" ADD COLUMN "shipcsx_terminal" text;
--> statement-breakpoint
CREATE TYPE "public"."csx_release_status" AS ENUM('OPEN', 'CLAIMED', 'PICKED_UP', 'CANCELLED');
--> statement-breakpoint
CREATE TYPE "public"."csx_release_source" AS ENUM('MANUAL', 'OCR');
--> statement-breakpoint
CREATE TYPE "public"."csx_lookup_tab" AS ENUM('NOTIFIED', 'ENROUTE', 'IN_GATE', 'OTHERS', 'NOT_FOUND');
--> statement-breakpoint
CREATE TABLE "csx_pickup_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"container_id" uuid,
	"container_number" text NOT NULL,
	"container_number_normalized" text NOT NULL,
	"pickup_number" text NOT NULL,
	"status" "csx_release_status" DEFAULT 'OPEN' NOT NULL,
	"source" "csx_release_source" DEFAULT 'MANUAL' NOT NULL,
	"claimed_trip_id" uuid,
	"picked_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csx_shipment_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"container_id" uuid,
	"container_number_normalized" text NOT NULL,
	"terminal_name" text NOT NULL,
	"equipment_number" text NOT NULL,
	"reference_used" text DEFAULT '00' NOT NULL,
	"result_tab" "csx_lookup_tab" DEFAULT 'NOT_FOUND' NOT NULL,
	"load_empty" text,
	"waybill_date" text,
	"in_gate_readiness" text,
	"gate_window" text,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "csx_poll_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_error" text,
	"skip_until" timestamp with time zone,
	"checked_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "csx_pickup_releases" ADD CONSTRAINT "csx_pickup_releases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "csx_pickup_releases" ADD CONSTRAINT "csx_pickup_releases_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "csx_pickup_releases" ADD CONSTRAINT "csx_pickup_releases_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "csx_pickup_releases" ADD CONSTRAINT "csx_pickup_releases_claimed_trip_id_trips_id_fk" FOREIGN KEY ("claimed_trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "csx_shipment_snapshots" ADD CONSTRAINT "csx_shipment_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "csx_shipment_snapshots" ADD CONSTRAINT "csx_shipment_snapshots_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "csx_poll_state" ADD CONSTRAINT "csx_poll_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "csx_pickup_releases_location_idx" ON "csx_pickup_releases" USING btree ("location_id","status");
--> statement-breakpoint
CREATE INDEX "csx_pickup_releases_company_number_idx" ON "csx_pickup_releases" USING btree ("company_id","container_number_normalized");
--> statement-breakpoint
CREATE UNIQUE INDEX "csx_pickup_releases_open_key" ON "csx_pickup_releases" USING btree ("company_id","location_id","container_number_normalized") WHERE status IN ('OPEN', 'CLAIMED');
--> statement-breakpoint
CREATE INDEX "csx_shipment_snapshots_container_idx" ON "csx_shipment_snapshots" USING btree ("container_id","checked_at");
--> statement-breakpoint
CREATE INDEX "csx_shipment_snapshots_company_idx" ON "csx_shipment_snapshots" USING btree ("company_id","checked_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "csx_poll_state_company_key" ON "csx_poll_state" USING btree ("company_id");
