ALTER TABLE "users" ADD COLUMN "unlocked_features" jsonb DEFAULT '[]'::jsonb NOT NULL;
