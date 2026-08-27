CREATE TABLE IF NOT EXISTS discovery_source_credentials (
  id varchar(36) PRIMARY KEY,
  "sourceKey" varchar(96) NOT NULL UNIQUE,
  "encryptedApiKey" text,
  "developmentFixtureEnabled" boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  "approvalStatus" varchar(16) NOT NULL DEFAULT 'candidate',
  priority integer NOT NULL DEFAULT 100,
  "maxResultsPerJob" integer NOT NULL DEFAULT 100,
  "dailyBudgetCents" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_source_credentials ADD COLUMN IF NOT EXISTS "developmentFixtureEnabled" boolean NOT NULL DEFAULT false;

INSERT INTO discovery_source_credentials (id, "sourceKey", "enabled", "approvalStatus", priority, "maxResultsPerJob", "dailyBudgetCents") VALUES
  ('source-openstreetmap-pilot-v1', 'openstreetmap-pilot-v1', true, 'approved', 10, 100, 0),
  ('source-foursquare-places-v1', 'foursquare-places-v1', false, 'candidate', 15, 100, 0),
  ('source-google-places-v1', 'google-places-v1', false, 'candidate', 20, 100, 0)
ON CONFLICT ("sourceKey") DO NOTHING;
