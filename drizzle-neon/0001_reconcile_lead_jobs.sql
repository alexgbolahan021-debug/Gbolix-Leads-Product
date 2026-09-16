CREATE TABLE IF NOT EXISTS "discovery_source_credentials" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"sourceKey" varchar(96) NOT NULL,
	"encryptedApiKey" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"developmentFixtureEnabled" boolean DEFAULT false NOT NULL,
	"approvalStatus" varchar(16) DEFAULT 'candidate' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"maxResultsPerJob" integer DEFAULT 100 NOT NULL,
	"dailyBudgetCents" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_source_credentials_key_unique" ON "discovery_source_credentials" USING btree ("sourceKey");
--> statement-breakpoint
ALTER TABLE "lead_jobs" ADD COLUMN IF NOT EXISTS "requestPayload" jsonb;
--> statement-breakpoint
ALTER TABLE "lead_jobs" ALTER COLUMN "operation" TYPE varchar(24) USING "operation"::text;
--> statement-breakpoint
ALTER TABLE "lead_jobs" ALTER COLUMN "requestPayload" TYPE jsonb USING CASE WHEN "requestPayload" IS NULL THEN NULL ELSE "requestPayload"::text::jsonb END;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_jobs_external_request_unique" ON "lead_jobs" USING btree ("externalRequestId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_jobs_workspace_status_idx" ON "lead_jobs" USING btree ("externalWorkspaceId","status");
