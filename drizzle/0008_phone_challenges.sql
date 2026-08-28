CREATE TABLE "phone_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "phone_e164" text NOT NULL,
  "code_hash" text NOT NULL,
  "ticket_hash" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "phone_challenges_phone_idx" ON "phone_challenges" ("company_id", "phone_e164", "purpose");--> statement-breakpoint
CREATE INDEX "phone_challenges_ticket_idx" ON "phone_challenges" ("ticket_hash");
