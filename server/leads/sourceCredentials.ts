import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { discoverySourceCredentials } from "../../drizzle/schema";
import { getDb } from "../db";

const sourceEncryptionKey = () => process.env.LEADS_SOURCE_CREDENTIAL_ENCRYPTION_KEY?.trim() || process.env.GBOLIX_INTEGRATION_SECRET?.trim();

function encrypt(value: string) {
  const configured = sourceEncryptionKey();
  if (!configured) throw new Error("LEADS_SOURCE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.createHash("sha256").update(configured).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value: string) {
  const configured = sourceEncryptionKey();
  if (!configured) throw new Error("LEADS_SOURCE_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED");
  const [ivPart, tagPart, ciphertextPart] = value.split(".");
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error("LEADS_SOURCE_CREDENTIAL_INVALID");
  const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.createHash("sha256").update(configured).digest(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}

export async function ensureDiscoverySourceCredentialsTable() {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`CREATE TABLE IF NOT EXISTS discovery_source_credentials (
    id varchar(36) PRIMARY KEY,
    "sourceKey" varchar(96) NOT NULL UNIQUE,
    "encryptedApiKey" text,
    enabled boolean NOT NULL DEFAULT false,
    "approvalStatus" varchar(16) NOT NULL DEFAULT 'candidate',
    priority integer NOT NULL DEFAULT 100,
    "maxResultsPerJob" integer NOT NULL DEFAULT 100,
    "dailyBudgetCents" integer NOT NULL DEFAULT 0,
    "updatedAt" timestamptz NOT NULL DEFAULT now()
  )`);
  await db.insert(discoverySourceCredentials).values([
    { id: "source-openstreetmap-pilot-v1", sourceKey: "openstreetmap-pilot-v1", enabled: true, approvalStatus: "approved", priority: 10 },
    { id: "source-foursquare-places-v1", sourceKey: "foursquare-places-v1", enabled: false, approvalStatus: "candidate", priority: 15 },
    { id: "source-google-places-v1", sourceKey: "google-places-v1", enabled: false, approvalStatus: "candidate", priority: 20 },
  ]).onConflictDoNothing();
}

export async function saveDiscoverySourceCredential(input: { sourceKey: "openstreetmap-pilot-v1" | "foursquare-places-v1" | "google-places-v1"; encryptedApiKey?: string | null; enabled: boolean; approvalStatus: "candidate" | "approved" | "blocked"; priority: number; maxResultsPerJob: number; dailyBudgetCents: number }) {
  const db = await getDb();
  if (!db) throw new Error("LEADS_DATABASE_UNAVAILABLE");
  await ensureDiscoverySourceCredentialsTable();
  const existing = (await db.select().from(discoverySourceCredentials).where(eq(discoverySourceCredentials.sourceKey, input.sourceKey)).limit(1))[0];
  const encryptedApiKey = input.encryptedApiKey ? encrypt(input.encryptedApiKey) : existing?.encryptedApiKey ?? null;
  const values = { id: existing?.id ?? `source-${input.sourceKey}`, sourceKey: input.sourceKey, encryptedApiKey, enabled: input.enabled, approvalStatus: input.approvalStatus, priority: Math.max(1, Math.round(input.priority)), maxResultsPerJob: Math.min(100, Math.max(1, Math.round(input.maxResultsPerJob))), dailyBudgetCents: Math.max(0, Math.round(input.dailyBudgetCents)), updatedAt: new Date() };
  const [saved] = existing ? await db.update(discoverySourceCredentials).set(values).where(eq(discoverySourceCredentials.id, existing.id)).returning() : await db.insert(discoverySourceCredentials).values(values).returning();
  return saved;
}

export async function getDiscoverySourceCredential(sourceKey: "openstreetmap-pilot-v1" | "foursquare-places-v1" | "google-places-v1") {
  if (sourceKey === "foursquare-places-v1" && process.env.NODE_ENV !== "production" && process.env.FOURSQUARE_MOCK_MODE === "true") return { id: "source-foursquare-places-v1", sourceKey, encryptedApiKey: null, enabled: true, approvalStatus: "approved", priority: 15, maxResultsPerJob: 100, dailyBudgetCents: 0, updatedAt: new Date(), apiKey: "mock-foursquare-key" };
  const db = await getDb();
  if (!db) {
    if (sourceKey === "openstreetmap-pilot-v1") return { id: "source-openstreetmap-pilot-v1", sourceKey, encryptedApiKey: null, enabled: true, approvalStatus: "approved", priority: 10, maxResultsPerJob: 100, dailyBudgetCents: 0, updatedAt: new Date(), apiKey: null };

    const legacyKey = sourceKey === "google-places-v1" ? process.env.GOOGLE_PLACES_API_KEY?.trim() : process.env.FOURSQUARE_PLACES_API_KEY?.trim();
    if (process.env.GOOGLE_PLACES_SOURCE_APPROVED === "true" && sourceKey === "google-places-v1" && legacyKey) return { id: "source-google-places-v1", sourceKey, encryptedApiKey: null, enabled: true, approvalStatus: "approved", priority: 20, maxResultsPerJob: 100, dailyBudgetCents: 0, updatedAt: new Date(), apiKey: legacyKey };
    if (process.env.FOURSQUARE_SOURCE_APPROVED === "true" && sourceKey === "foursquare-places-v1" && legacyKey) return { id: "source-foursquare-places-v1", sourceKey, encryptedApiKey: null, enabled: true, approvalStatus: "approved", priority: 15, maxResultsPerJob: 100, dailyBudgetCents: 0, updatedAt: new Date(), apiKey: legacyKey };
    return null;
  }
  await ensureDiscoverySourceCredentialsTable();
  const [source] = await db.select().from(discoverySourceCredentials).where(eq(discoverySourceCredentials.sourceKey, sourceKey)).limit(1);
  if (!source || !source.enabled || source.approvalStatus !== "approved") return null;
  if (sourceKey !== "openstreetmap-pilot-v1" && !source.encryptedApiKey) return null;
  return { ...source, apiKey: source.encryptedApiKey ? decrypt(source.encryptedApiKey) : null };
}
