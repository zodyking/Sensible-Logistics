ALTER TABLE "trips" ADD COLUMN "kind" text DEFAULT 'CONTAINER' NOT NULL;--> statement-breakpoint
ALTER TABLE "container_events" ALTER COLUMN "container_id" DROP NOT NULL;
