CREATE TYPE "public"."container_status" AS ENUM('AVAILABLE', 'IN_TRANSIT', 'AT_YARD', 'LOADING', 'RETURNED');--> statement-breakpoint
ALTER TABLE "containers" ADD COLUMN "container_status" "container_status" DEFAULT 'AVAILABLE' NOT NULL;--> statement-breakpoint
UPDATE "containers" SET "container_status" = CASE
  WHEN "active_pool_state" = 'DRIVER_CUSTODY' THEN 'IN_TRANSIT'::"container_status"
  WHEN "active_pool_state" = 'PICKUP_IN_PROGRESS' THEN 'IN_TRANSIT'::"container_status"
  WHEN "active_pool_state" = 'INACTIVE' THEN 'RETURNED'::"container_status"
  ELSE 'AVAILABLE'::"container_status"
END;--> statement-breakpoint
CREATE INDEX "containers_company_status_idx" ON "containers" USING btree ("company_id","container_status");
