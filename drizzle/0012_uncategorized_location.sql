ALTER TABLE "locations" ADD COLUMN "is_uncategorized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_one_uncategorized_per_company" ON "locations" USING btree ("company_id") WHERE is_uncategorized = true and deleted_at is null;
