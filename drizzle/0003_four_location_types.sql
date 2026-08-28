UPDATE "locations" SET "type" = 'CUSTOMER' WHERE "type" IN ('WAREHOUSE');--> statement-breakpoint
UPDATE "locations" SET "type" = 'COMPANY_YARD' WHERE "type" IN ('DEPOT', 'REPAIR_SHOP', 'STAGING', 'TEMPORARY');--> statement-breakpoint
ALTER TYPE "location_type" RENAME TO "location_type_old";--> statement-breakpoint
CREATE TYPE "location_type" AS ENUM('COMPANY_YARD', 'CUSTOMER', 'MARINE_TERMINAL', 'RAIL_TERMINAL');--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "type" TYPE "location_type" USING "type"::text::"location_type";--> statement-breakpoint
DROP TYPE "location_type_old";
