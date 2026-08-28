ALTER TABLE "trips" ADD COLUMN "swap_pair_trip_id" uuid;--> statement-breakpoint
CREATE INDEX "trips_swap_pair_idx" ON "trips" USING btree ("swap_pair_trip_id");
