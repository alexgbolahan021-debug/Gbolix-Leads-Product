import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("[Database] DATABASE_URL is not configured; skipping reconciliation");
  process.exit(0);
}

const client = new Client({
  connectionString,
  ssl: connectionString.includes("neon.tech") ? { rejectUnauthorized: false } : undefined,
});

const statements = [
  `CREATE TABLE IF NOT EXISTS discovery_source_credentials (
    id varchar(36) PRIMARY KEY,
    "sourceKey" varchar(96) NOT NULL UNIQUE,
    "encryptedApiKey" text,
    enabled boolean NOT NULL DEFAULT false,
    "developmentFixtureEnabled" boolean NOT NULL DEFAULT false,
    "approvalStatus" varchar(16) NOT NULL DEFAULT 'candidate',
    priority integer NOT NULL DEFAULT 100,
    "maxResultsPerJob" integer NOT NULL DEFAULT 100,
    "dailyBudgetCents" integer NOT NULL DEFAULT 0,
    "updatedAt" timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE lead_jobs ADD COLUMN IF NOT EXISTS "requestPayload" jsonb`,
  `ALTER TABLE lead_jobs ALTER COLUMN operation TYPE varchar(24) USING operation::text`,
  `ALTER TABLE lead_jobs ALTER COLUMN "requestPayload" TYPE jsonb USING CASE WHEN "requestPayload" IS NULL THEN NULL ELSE "requestPayload"::text::jsonb END`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lead_jobs_external_request_unique ON lead_jobs ("externalRequestId")`,
  `CREATE INDEX IF NOT EXISTS lead_jobs_workspace_status_idx ON lead_jobs ("externalWorkspaceId", status)`,
];

try {
  await client.connect();
  for (const statement of statements) await client.query(statement);
  console.log("[Database] PostgreSQL reconciliation completed");
} catch (error) {
  console.error("[Database] PostgreSQL reconciliation failed", {
    code: error?.code,
    detail: error?.detail,
    hint: error?.hint,
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
