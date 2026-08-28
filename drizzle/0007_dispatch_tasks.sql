CREATE TYPE "public"."dispatch_task_kind" AS ENUM('PICKUP', 'DROPOFF', 'LOAD', 'EMPTY', 'WORK', 'NOTE');--> statement-breakpoint
CREATE TYPE "public"."dispatch_task_status" AS ENUM('OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."dispatch_task_source" AS ENUM('SMS');--> statement-breakpoint
CREATE TABLE "sms_inbound_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"token" text NOT NULL,
	"last_received_at" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"source" "dispatch_task_source" DEFAULT 'SMS' NOT NULL,
	"raw_text" text NOT NULL,
	"sender" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"work_date" date NOT NULL,
	"kind" "dispatch_task_kind" DEFAULT 'NOTE' NOT NULL,
	"title" text NOT NULL,
	"parsed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "dispatch_task_status" DEFAULT 'OPEN' NOT NULL,
	"trip_id" uuid,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_inbound_endpoints" ADD CONSTRAINT "sms_inbound_endpoints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_inbound_endpoints" ADD CONSTRAINT "sms_inbound_endpoints_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_tasks" ADD CONSTRAINT "dispatch_tasks_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_inbound_endpoints_token_key" ON "sms_inbound_endpoints" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_inbound_endpoints_driver_key" ON "sms_inbound_endpoints" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_tasks_driver_fingerprint_key" ON "dispatch_tasks" USING btree ("driver_id","fingerprint");--> statement-breakpoint
CREATE INDEX "dispatch_tasks_driver_work_date_idx" ON "dispatch_tasks" USING btree ("driver_id","work_date");--> statement-breakpoint
CREATE INDEX "dispatch_tasks_trip_idx" ON "dispatch_tasks" USING btree ("trip_id");
