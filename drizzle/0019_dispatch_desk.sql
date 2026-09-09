ALTER TYPE "public"."dispatch_task_status" ADD VALUE IF NOT EXISTS 'DRAFT';--> statement-breakpoint
ALTER TYPE "public"."dispatch_task_source" ADD VALUE IF NOT EXISTS 'DISPATCH';--> statement-breakpoint
ALTER TABLE "dispatch_tasks" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;
