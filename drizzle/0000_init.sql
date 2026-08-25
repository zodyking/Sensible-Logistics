CREATE TYPE "public"."active_pool_state" AS ENUM('INACTIVE', 'PICKUP_IN_PROGRESS', 'DRIVER_CUSTODY', 'AT_LOCATION', 'EXCEPTION');--> statement-breakpoint
CREATE TYPE "public"."chassis_status" AS ENUM('AVAILABLE', 'IN_USE', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."container_type" AS ENUM('TROPICAL', 'ZIM', 'CMA', 'KING_OCEAN');--> statement-breakpoint
CREATE TYPE "public"."cycle_type" AS ENUM('SIXTY_SEVEN', 'SEVENTY_EIGHT');--> statement-breakpoint
CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'SEVERE', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('EIR', 'POD', 'BILL_OF_LADING', 'DELIVERY_ORDER', 'GATE_TICKET', 'SCALE_TICKET', 'DAMAGE_REPORT', 'REPAIR_INVOICE', 'CUSTOMS', 'PHOTO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('DRY_20', 'DRY_40', 'HC_40', 'HC_45', 'REEFER', 'TANK', 'OPEN_TOP', 'FLAT_RACK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('MANUAL', 'OCR', 'GEOFENCE', 'IMPORT', 'API', 'ADMIN_EDIT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('PICKUP_STARTED', 'PICKUP_CONFIRMED', 'DROPOFF_STARTED', 'DROPOFF_CONFIRMED', 'GATE_IN', 'GATE_OUT', 'ARRIVED', 'DEPARTED', 'YARD_MOVE', 'CHASSIS_ATTACH', 'CHASSIS_DETACH', 'LOADED', 'EMPTIED', 'DOCUMENT_ADDED', 'DAMAGE_REPORTED', 'CORRECTION', 'STATUS_CHANGE', 'RELEASED', 'ACTIVATED', 'PICKUP_CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."location_status" AS ENUM('ACTIVE', 'PENDING_APPROVAL', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('MARINE_TERMINAL', 'RAIL_TERMINAL', 'CUSTOMER', 'WAREHOUSE', 'COMPANY_YARD', 'DEPOT', 'REPAIR_SHOP', 'STAGING', 'TEMPORARY');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'DELIVERED', 'READ', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."ocr_source_type" AS ENUM('CONTAINER', 'CHASSIS', 'SEAL', 'DOCUMENT');--> statement-breakpoint
CREATE TYPE "public"."ocr_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'NOT_IMPLEMENTED');--> statement-breakpoint
CREATE TYPE "public"."ocr_validation_status" AS ENUM('VALID', 'INVALID', 'UNVERIFIED');--> statement-breakpoint
CREATE TYPE "public"."radius_evidence_level" AS ENUM('NONE', 'RECORDED_LOCATIONS_ONLY', 'GPS_VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('DRIVER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."short_haul_status" AS ENUM('QUALIFIED', 'AT_RISK', 'NOT_AVAILABLE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."timecard_status" AS ENUM('OPEN', 'COMPLETED', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('DRAFT', 'PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS', 'DROPPED_OFF', 'COMPLETED', 'CANCELLED', 'EXCEPTION');--> statement-breakpoint
CREATE TYPE "public"."yard_object_type" AS ENUM('BUILDING', 'ROAD', 'FENCE', 'GATE', 'SLOT', 'ROW', 'LABEL', 'RESTRICTED', 'PARKING');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chassis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"number_normalized" text NOT NULL,
	"provider" text,
	"size_compatibility" text,
	"license_plate" text,
	"vin" text,
	"status" "chassis_status" DEFAULT 'AVAILABLE' NOT NULL,
	"out_of_service" boolean DEFAULT false NOT NULL,
	"current_container_id" uuid,
	"current_location_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"usdot_number" text,
	"invite_code" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"cycle_type" "cycle_type" DEFAULT 'SEVENTY_EIGHT' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_driver_id" uuid,
	"source" "event_source" DEFAULT 'MANUAL' NOT NULL,
	"trip_id" uuid,
	"location_id" uuid,
	"chassis_id" uuid,
	"gps_latitude" numeric(10, 7),
	"gps_longitude" numeric(10, 7),
	"gps_accuracy_meters" real,
	"yard_position" jsonb,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"corrects_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "container_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"container_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"layout_id" uuid,
	"zone_id" uuid,
	"slot_code" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"stack_level" integer DEFAULT 0 NOT NULL,
	"superseded_at" timestamp with time zone,
	"event_id" uuid,
	"placed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"number_normalized" text NOT NULL,
	"check_digit_valid" boolean DEFAULT false NOT NULL,
	"container_type" "container_type" NOT NULL,
	"equipment_type" "equipment_type" DEFAULT 'DRY_40' NOT NULL,
	"is_loaded" boolean DEFAULT false NOT NULL,
	"seal_number" text,
	"booking_number" text,
	"bill_of_lading" text,
	"customer_reference" text,
	"purchase_order" text,
	"release_number" text,
	"commodity" text,
	"steamship_line" text,
	"terminal_reference" text,
	"active_pool_state" "active_pool_state" DEFAULT 'INACTIVE' NOT NULL,
	"current_driver_id" uuid,
	"current_location_id" uuid,
	"active_movement_id" uuid,
	"current_chassis_id" uuid,
	"activated_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"availability_date" date,
	"last_free_day" date,
	"empty_return_deadline" date,
	"appointment_at" timestamp with time zone,
	"is_reefer" boolean DEFAULT false NOT NULL,
	"is_hazmat" boolean DEFAULT false NOT NULL,
	"is_overweight" boolean DEFAULT false NOT NULL,
	"is_damaged" boolean DEFAULT false NOT NULL,
	"customs_hold" boolean DEFAULT false NOT NULL,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"do_not_move" boolean DEFAULT false NOT NULL,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"container_id" uuid,
	"chassis_id" uuid,
	"trip_id" uuid,
	"event_id" uuid,
	"severity" "damage_severity" DEFAULT 'MINOR' NOT NULL,
	"area" text,
	"description" text NOT NULL,
	"reported_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"category" "document_category" DEFAULT 'OTHER' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"checksum" text,
	"container_id" uuid,
	"trip_id" uuid,
	"chassis_id" uuid,
	"location_id" uuid,
	"event_id" uuid,
	"extracted_text" text,
	"ocr_status" "ocr_status" DEFAULT 'PENDING' NOT NULL,
	"replaces_document_id" uuid,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "driver_timecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"reporting_location_id" uuid,
	"reported_for_duty_at" timestamp with time zone,
	"released_from_duty_at" timestamp with time zone,
	"total_on_duty_minutes" integer DEFAULT 0 NOT NULL,
	"status" timecard_status DEFAULT 'OPEN' NOT NULL,
	"short_haul_status" "short_haul_status" DEFAULT 'UNKNOWN' NOT NULL,
	"cycle_type" "cycle_type" DEFAULT 'SEVENTY_EIGHT' NOT NULL,
	"preceding_7_day_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"retain_until" date
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"driver_code" text,
	"cdl_number" text,
	"cdl_state" text,
	"home_terminal_location_id" uuid,
	"preferred_truck_id" uuid,
	"status" "driver_status" DEFAULT 'AVAILABLE' NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"boundary" geometry(Polygon,4326),
	"local_geometry" jsonb,
	"capacity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "location_type" NOT NULL,
	"location_code" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"normalized_address" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"boundary" geometry(Polygon,4326),
	"centroid" geometry(Point,4326),
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"hours" text,
	"appointment_required" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"gate_instructions" text,
	"driver_notes" text,
	"capacity" integer,
	"status" "location_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"deep_link" text,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_document_id" uuid,
	"source_type" "ocr_source_type" NOT NULL,
	"engine" text DEFAULT 'paddleocr' NOT NULL,
	"engine_version" text,
	"model_name" text,
	"preprocessing_profile" text,
	"status" "ocr_status" DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"raw_response" jsonb,
	"detected_regions" jsonb,
	"candidate_values" jsonb,
	"selected_value" text,
	"confidence" real,
	"validation_status" "ocr_validation_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"check_digit_valid" boolean,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"correction_reason" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timecard_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"timecard_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"counted_as_off_duty" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timecard_compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"timecard_id" uuid NOT NULL,
	"prior_off_duty_minutes" integer,
	"max_recorded_air_miles" real,
	"returned_to_reporting_location" boolean,
	"released_within_14_hours" boolean,
	"rolling_cycle_minutes" integer,
	"radius_evidence_level" "radius_evidence_level" DEFAULT 'RECORDED_LOCATIONS_ONLY' NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timecard_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"timecard_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"original_value" text,
	"corrected_value" text,
	"changed_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timecard_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"timecard_id" uuid,
	"range_start" date,
	"range_end" date,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by_user_id" uuid,
	"file_id" uuid,
	"verification_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"location_id" uuid,
	"planned_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"driver_id" uuid NOT NULL,
	"truck_id" uuid,
	"container_id" uuid,
	"chassis_id" uuid,
	"origin_location_id" uuid,
	"destination_location_id" uuid,
	"status" "trip_status" DEFAULT 'DRAFT' NOT NULL,
	"is_loaded" boolean DEFAULT false NOT NULL,
	"seal_number" text,
	"customer" text,
	"steamship_line" text,
	"reference_numbers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planned_pickup_at" timestamp with time zone,
	"appointment_at" timestamp with time zone,
	"planned_delivery_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"dropped_off_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"is_final_release" boolean DEFAULT false NOT NULL,
	"exception_type" text,
	"driver_notes" text,
	"review_notes" text,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"plate" text,
	"vin" text,
	"assigned_driver_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"mobile_number" text,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"profile_photo_url" text,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yard_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"plane_width" real DEFAULT 1000 NOT NULL,
	"plane_height" real DEFAULT 700 NOT NULL,
	"geo_transform" jsonb,
	"supports_stacking" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yard_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"type" "yard_object_type" NOT NULL,
	"label" text,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"zone_id" uuid,
	"slot_code" text,
	"style" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chassis" ADD CONSTRAINT "chassis_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_events" ADD CONSTRAINT "container_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_events" ADD CONSTRAINT "container_events_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_placements" ADD CONSTRAINT "container_placements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_placements" ADD CONSTRAINT "container_placements_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_placements" ADD CONSTRAINT "container_placements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_timecards" ADD CONSTRAINT "driver_timecards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_timecards" ADD CONSTRAINT "driver_timecards_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_zones" ADD CONSTRAINT "location_zones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_zones" ADD CONSTRAINT "location_zones_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_results" ADD CONSTRAINT "ocr_results_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_breaks" ADD CONSTRAINT "timecard_breaks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_breaks" ADD CONSTRAINT "timecard_breaks_timecard_id_driver_timecards_id_fk" FOREIGN KEY ("timecard_id") REFERENCES "public"."driver_timecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_compliance_checks" ADD CONSTRAINT "timecard_compliance_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_compliance_checks" ADD CONSTRAINT "timecard_compliance_checks_timecard_id_driver_timecards_id_fk" FOREIGN KEY ("timecard_id") REFERENCES "public"."driver_timecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_corrections" ADD CONSTRAINT "timecard_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_corrections" ADD CONSTRAINT "timecard_corrections_timecard_id_driver_timecards_id_fk" FOREIGN KEY ("timecard_id") REFERENCES "public"."driver_timecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_exports" ADD CONSTRAINT "timecard_exports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD CONSTRAINT "yard_layouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_layouts" ADD CONSTRAINT "yard_layouts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_objects" ADD CONSTRAINT "yard_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yard_objects" ADD CONSTRAINT "yard_objects_layout_id_yard_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."yard_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_company_idx" ON "audit_logs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chassis_company_number_key" ON "chassis" USING btree ("company_id","number_normalized");--> statement-breakpoint
CREATE INDEX "chassis_company_idx" ON "chassis" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_invite_code_key" ON "companies" USING btree ("invite_code");--> statement-breakpoint
CREATE UNIQUE INDEX "company_memberships_company_user_key" ON "company_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "company_memberships_user_idx" ON "company_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "container_events_container_idx" ON "container_events" USING btree ("container_id","occurred_at");--> statement-breakpoint
CREATE INDEX "container_events_company_idx" ON "container_events" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "container_events_trip_idx" ON "container_events" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "container_placements_container_idx" ON "container_placements" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "container_placements_location_idx" ON "container_placements" USING btree ("location_id","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "containers_company_number_key" ON "containers" USING btree ("company_id","number_normalized");--> statement-breakpoint
CREATE INDEX "containers_company_state_idx" ON "containers" USING btree ("company_id","active_pool_state");--> statement-breakpoint
CREATE INDEX "containers_current_location_idx" ON "containers" USING btree ("current_location_id");--> statement-breakpoint
CREATE INDEX "containers_current_driver_idx" ON "containers" USING btree ("current_driver_id");--> statement-breakpoint
CREATE INDEX "damage_reports_company_idx" ON "damage_reports" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_company_idx" ON "documents" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_container_idx" ON "documents" USING btree ("container_id");--> statement-breakpoint
CREATE INDEX "documents_trip_idx" ON "documents" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_timecards_driver_date_key" ON "driver_timecards" USING btree ("driver_id","work_date");--> statement-breakpoint
CREATE INDEX "driver_timecards_company_date_idx" ON "driver_timecards" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_company_user_key" ON "drivers" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "drivers_company_idx" ON "drivers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "location_zones_location_idx" ON "location_zones" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "locations_company_idx" ON "locations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "locations_company_name_idx" ON "locations" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "locations_normalized_address_idx" ON "locations" USING btree ("company_id","normalized_address");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ocr_results_company_idx" ON "ocr_results" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "timecard_breaks_timecard_idx" ON "timecard_breaks" USING btree ("timecard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timecard_compliance_checks_timecard_key" ON "timecard_compliance_checks" USING btree ("timecard_id");--> statement-breakpoint
CREATE INDEX "timecard_corrections_timecard_idx" ON "timecard_corrections" USING btree ("timecard_id");--> statement-breakpoint
CREATE INDEX "timecard_exports_company_idx" ON "timecard_exports" USING btree ("company_id","generated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_stops_trip_sequence_key" ON "trip_stops" USING btree ("trip_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_company_reference_key" ON "trips" USING btree ("company_id","reference");--> statement-breakpoint
CREATE INDEX "trips_driver_status_idx" ON "trips" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "trips_company_status_idx" ON "trips" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_one_active_claim_per_container" ON "trips" USING btree ("container_id") WHERE status in ('PICKUP_IN_PROGRESS','IN_TRANSIT','DROPOFF_IN_PROGRESS');--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_company_unit_key" ON "trucks" USING btree ("company_id","unit_number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "yard_layouts_location_idx" ON "yard_layouts" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yard_layouts_location_version_key" ON "yard_layouts" USING btree ("location_id","version");--> statement-breakpoint
CREATE INDEX "yard_objects_layout_idx" ON "yard_objects" USING btree ("layout_id");