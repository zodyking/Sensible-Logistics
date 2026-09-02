CREATE TYPE "yard_layout_status" AS ENUM('PENDING', 'GENERATING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "yard_feature_type" AS ENUM('PAVEMENT', 'BUILDING', 'ROAD', 'DRIVEWAY', 'RAIL', 'FENCE', 'GATE', 'VEGETATION');--> statement-breakpoint
CREATE TYPE "yard_feature_source" AS ENUM('OSM', 'ORTHO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "yard_asset_type" AS ENUM('CHASSIS');--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "boundary" jsonb;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "origin_lng" real;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "origin_lat" real;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "rotation_deg" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "status" "yard_layout_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "generator_version" text;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE TABLE "yard_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"type" "yard_feature_type" NOT NULL,
	"local_geometry" jsonb NOT NULL,
	"geo_geometry" jsonb NOT NULL,
	"source" "yard_feature_source" DEFAULT 'OSM' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"manually_modified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "yard_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" text DEFAULT 'CONTAINER' NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"manually_modified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "yard_asset_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"asset_type" "yard_asset_type" NOT NULL,
	"asset_id" uuid NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"slot_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "yard_features" ADD CONSTRAINT "yard_features_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_features" ADD CONSTRAINT "yard_features_layout_id_yard_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."yard_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_slots" ADD CONSTRAINT "yard_slots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_slots" ADD CONSTRAINT "yard_slots_layout_id_yard_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."yard_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_asset_positions" ADD CONSTRAINT "yard_asset_positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_asset_positions" ADD CONSTRAINT "yard_asset_positions_layout_id_yard_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."yard_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_asset_positions" ADD CONSTRAINT "yard_asset_positions_slot_id_yard_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."yard_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "yard_features_layout_idx" ON "yard_features" USING btree ("layout_id");--> statement-breakpoint
CREATE INDEX "yard_features_layout_type_idx" ON "yard_features" USING btree ("layout_id","type");--> statement-breakpoint
CREATE INDEX "yard_slots_layout_idx" ON "yard_slots" USING btree ("layout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yard_slots_layout_code_key" ON "yard_slots" USING btree ("layout_id","code");--> statement-breakpoint
CREATE INDEX "yard_asset_positions_layout_idx" ON "yard_asset_positions" USING btree ("layout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yard_asset_positions_layout_asset_key" ON "yard_asset_positions" USING btree ("layout_id","asset_type","asset_id");
