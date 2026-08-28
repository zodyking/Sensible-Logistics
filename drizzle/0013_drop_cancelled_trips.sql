UPDATE "containers"
SET "active_movement_id" = NULL
WHERE "active_movement_id" IN (SELECT "id" FROM "trips" WHERE "status" = 'CANCELLED');--> statement-breakpoint
UPDATE "trips"
SET "swap_pair_trip_id" = NULL
WHERE "swap_pair_trip_id" IN (SELECT "id" FROM "trips" WHERE "status" = 'CANCELLED');--> statement-breakpoint
DELETE FROM "trips" WHERE "status" = 'CANCELLED';
