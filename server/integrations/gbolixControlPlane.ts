import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { parseDomainList, parseLeadCsv } from "../leads/csv";
import { discoveryAdapterRegistry } from "../leads/adapters";
import { getDiscoverySourceCredential, saveDiscoverySourceCredential } from "../leads/sourceCredentials";
import { getIntegrationSecret } from "../leads/integration";
import { authorizeWorkspaceExportDownload, createWorkspaceRequestExport, getWorkspaceRequestResults, ingestProviderDiscovery, ingestUserLeads, listPendingIntegrationEvents, markIntegrationEventDelivery } from "../leadDb";

export const gbolixLeadIntakeSchema = z.object({
  externalRequestId: z.string().trim().min(8).max(128),
  externalWorkspaceId: z.string().trim().min(1).max(128),
  externalCustomerId: z.string().trim().max(128).optional(),
  actorId: z.string().trim().max(128).optional(),
  creditAuthorizationId: z.string().trim().min(6).max(128),
  label: z.string().trim().min(1).max(255),
  inputType: z.enum(["csv_upload", "domain_list", "openstreetmap_discovery"]),
  rawContent: z.string().max(1_000_000),
  categoryCode: z.string().trim().min(1).max(96),
  keywords: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
  discovery: z.object({
    adapterKey: z.enum(["openstreetmap-pilot-v1", "foursquare-places-v1", "google-places-v1"]),
    city: z.string().trim().min(2).max(128).optional(),
    cities: z.array(z.string().trim().min(2).max(128)).min(1).max(10).optional(),
    country: z.string().trim().min(2).max(96).optional(),
    regions: z.array(z.string().trim().min(2).max(128)).max(10).optional(),
    limit: z.number().int().min(1).max(100),
  }).optional().refine(value => !value || Boolean(value.city || value.cities?.length), { message: "At least one discovery city is required." }),
});

export function buildDiscoveryRequestMetadata(input: { adapterKey: string; city?: string; cities?: string[]; country?: string; regions?: string[]; keywords: string[]; requestedLimit: number }) {
  const attribution = input.adapterKey === "google-places-v1" ? "Google Places API" : input.adapterKey === "foursquare-places-v1" ? "Foursquare Places API" : "© OpenStreetMap contributors";
  return { adapterKey: input.adapterKey, city: input.city ?? input.cities?.[0] ?? null, cities: input.cities ?? (input.city ? [input.city] : []), country: input.country ?? null, regions: input.regions ?? [], keywords: input.keywords, requestedLimit: input.requestedLimit, attribution };
}

export const buildOpenStreetMapRequestMetadata = buildDiscoveryRequestMetadata;

const sourceSyncSchema = z.object({
  sourceKey: z.enum(["openstreetmap-pilot-v1", "foursquare-places-v1", "google-places-v1"]),
  apiKey: z.string().trim().max(512).nullable().optional(),
  enabled: z.boolean(),
  approvalStatus: z.enum(["candidate", "approved", "blocked"]),
  priority: z.number().int().min(1).max(10_000),
  maxResultsPerJob: z.number().int().min(1).max(100),
  dailyBudgetCents: z.number().int().min(0).max(100_000_000),
});

const resultsSchema = z.object({
  externalRequestId: z.string().trim().min(8).max(128),
  externalWorkspaceId: z.string().trim().min(1).max(128),
  actorId: z.string().trim().max(128).optional(),
});

function verifySignedPayload(req: Request, payload: unknown) {
  return verifyGbolixInboundSignature(getIntegrationSecret(), req.header("x-gbolix-timestamp"), req.header("x-gbolix-signature"), payload);
}

export function verifyGbolixInboundSignature(secret: string, timestamp: string | undefined, signature: string | undefined, payload: unknown) {
  if (!timestamp || !signature) return false;
  const issuedAt = Date.parse(timestamp);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(payload)}`).digest("hex");
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function buildGbolixUsageCallback(secret: string, payload: { externalRequestId: string; jobId: string; createdCount: number; duplicateCount: number }) {
  const timestamp = new Date().toISOString();
  const body = {
    deliveryId: `delivery_${randomUUID().replace(/-/g, "")}`,
    eventType: "lead_usage_finalized",
    requestKey: payload.externalRequestId,
    leadJobId: payload.jobId,
    progress: { processedLeads: payload.createdCount + payload.duplicateCount, qualifiedLeads: payload.createdCount, duplicatesSuppressed: payload.duplicateCount },
    usage: { newQualifiedLeads: payload.createdCount, duplicatesSuppressed: payload.duplicateCount },
  };
  const signature = createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(body)}`).digest("hex");
  return { timestamp, body, signature };
}

function safeCallbackTarget(callbackUrl: string | undefined) {
  if (!callbackUrl) return "not-configured";
  try { return new URL(callbackUrl).host || "invalid-host"; } catch { return "invalid-url"; }
}

async function deliverUsageEvent(event: { id: string; externalRequestId: string; leadJobId: string | null; creditAuthorizationId: string | null; payload: unknown }) {
  const callbackUrl = process.env.GBOLIX_CONTROL_PLANE_CALLBACK_URL;
  const callbackSecret = process.env.GBOLIX_CONTROL_PLANE_CALLBACK_SECRET;
  if (!callbackUrl || !callbackSecret) {
    await markIntegrationEventDelivery({ eventId: event.id, state: "pending", errorCode: "CALLBACK_NOT_CONFIGURED" });
    return { delivered: false, reason: "callback_not_configured" as const };
  }
  if (!event.leadJobId) {
    await markIntegrationEventDelivery({ eventId: event.id, state: "failed", errorCode: "CALLBACK_JOB_ID_MISSING" });
    return { delivered: false, reason: "job_id_missing" as const };
  }
  const eventPayload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
  const createdCount = Number(eventPayload.newQualifiedLeads ?? eventPayload.chargeableCredits ?? 0);
  const duplicateCount = Number(eventPayload.existingDuplicates ?? 0);
  try {
    const { timestamp, body, signature } = buildGbolixUsageCallback(process.env.GBOLIX_CONTROL_PLANE_CALLBACK_SECRET!, { externalRequestId: event.externalRequestId, jobId: event.leadJobId, createdCount, duplicateCount });
    const response = await fetch(callbackUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Gbolix-Timestamp": timestamp, "X-Gbolix-Signature": signature }, body: JSON.stringify(body) });
    if (!response.ok) {
      const errorCode = `CALLBACK_HTTP_${response.status}`;
      await markIntegrationEventDelivery({ eventId: event.id, state: "pending", errorCode });
      console.error("Gbolix control-plane callback rejected", { errorCode, target: safeCallbackTarget(callbackUrl), externalRequestId: event.externalRequestId });
      return { delivered: false, reason: errorCode } as const;
    }
    await markIntegrationEventDelivery({ eventId: event.id, state: "delivered" });
    return { delivered: true as const };
  } catch {
    await markIntegrationEventDelivery({ eventId: event.id, state: "pending", errorCode: "CALLBACK_FETCH_FAILED" });
    console.error("Gbolix control-plane callback delivery failed", { errorCode: "CALLBACK_FETCH_FAILED", target: safeCallbackTarget(callbackUrl), externalRequestId: event.externalRequestId });
    return { delivered: false, reason: "callback_fetch_failed" as const };
  }
}

async function emitUsageFinalized(eventId: string) {
  const event = (await listPendingIntegrationEvents(100)).find(candidate => candidate.id === eventId);
  if (!event) return { delivered: false, reason: "callback_event_not_found" as const };
  return deliverUsageEvent(event);
}

export async function reconcilePendingUsageEvents() {
  if (!process.env.GBOLIX_CONTROL_PLANE_CALLBACK_URL || !process.env.GBOLIX_CONTROL_PLANE_CALLBACK_SECRET) return { attempted: 0, skipped: 0, failed: 0 };
  const events = await listPendingIntegrationEvents(20);
  let attempted = 0;
  let skipped = 0;
  let failed = 0;
  for (const event of events) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    const attempts = Number(payload.deliveryAttempts ?? 0);
    const lastAttemptAt = typeof payload.lastDeliveryAttemptAt === "string" ? Date.parse(payload.lastDeliveryAttemptAt) : NaN;
    const retryDelay = Math.min(15 * 60 * 1000, 30 * 1000 * (2 ** Math.min(attempts, 5)));
    if (attempts >= 12) {
      await markIntegrationEventDelivery({ eventId: event.id, state: "failed", errorCode: "CALLBACK_RETRY_EXHAUSTED" });
      failed += 1;
      continue;
    }
    if (Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt < retryDelay) { skipped += 1; continue; }
    attempted += 1;
    const result = await deliverUsageEvent(event);
    if (!result.delivered) failed += 1;
  }
  return { attempted, skipped, failed };
}

export function registerGbolixControlPlaneRoutes(app: Express) {
  app.post("/api/integrations/gbolix/leads/sources/sync", async (req: Request, res: Response) => {
    const payload = sourceSyncSchema.safeParse(req.body);
    if (!payload.success) return res.status(400).json({ error: "INVALID_GBOLIX_SOURCE_SYNC", details: payload.error.flatten() });
    if (!verifySignedPayload(req, payload.data)) return res.status(401).json({ error: "GBOLIX_SIGNATURE_INVALID" });
    try {
          await saveDiscoverySourceCredential({ ...payload.data, encryptedApiKey: payload.data.apiKey });
      return res.json({ ok: true });
    } catch (error) {
      console.error("Gbolix discovery source sync failed", { code: "GBOLIX_SOURCE_SYNC_FAILED", sourceKey: payload.data.sourceKey, error: error instanceof Error ? error.message : "unknown_error" });
      return res.status(500).json({ error: "GBOLIX_SOURCE_SYNC_FAILED", message: "Unable to synchronize discovery source policy" });
    }
  });

  app.post("/api/integrations/gbolix/leads/ingest", async (req: Request, res: Response) => {
    const payload = gbolixLeadIntakeSchema.safeParse(req.body);
    if (!payload.success) return res.status(400).json({ error: "INVALID_GBOLIX_REQUEST", details: payload.error.flatten() });
    if (!verifySignedPayload(req, payload.data)) return res.status(401).json({ error: "GBOLIX_SIGNATURE_INVALID" });
    try {
      const common = {
        workspaceId: payload.data.externalWorkspaceId,
        customerId: payload.data.externalCustomerId,
        actorId: payload.data.actorId,
        externalRequestId: payload.data.externalRequestId,
        creditAuthorizationId: payload.data.creditAuthorizationId,
        label: payload.data.label,
        categoryCode: payload.data.categoryCode,
      };
      const result = payload.data.inputType === "openstreetmap_discovery"
        ? await (async () => {
          if (!payload.data.discovery) throw new Error("Provider discovery requires at least one city, category, and limit.");
          const adapter = discoveryAdapterRegistry.find(candidate => candidate.key === payload.data.discovery?.adapterKey && candidate.sourcePolicy === "approved");
          if (!adapter) throw new Error("The requested discovery adapter is not enabled.");
          if (!await getDiscoverySourceCredential(payload.data.discovery.adapterKey)) throw new Error("The requested discovery source is not approved or configured.");
          const cities = payload.data.discovery.cities ?? (payload.data.discovery.city ? [payload.data.discovery.city] : []);
          const discovered = await adapter.discover({ cities, country: payload.data.discovery.country, regions: payload.data.discovery.regions, categoryCode: payload.data.categoryCode, keywords: payload.data.keywords, limit: payload.data.discovery.limit });
          return ingestProviderDiscovery({ ...common, valid: discovered.records, invalid: [], provenance: discovered.provenance, adapterKey: discovered.adapterKey, requestMetadata: buildDiscoveryRequestMetadata({ adapterKey: discovered.adapterKey, city: payload.data.discovery.city, cities, country: payload.data.discovery.country, regions: payload.data.discovery.regions, keywords: payload.data.keywords, requestedLimit: payload.data.discovery.limit }) });
        })()
        : await (async () => {
          if (!payload.data.rawContent.trim()) throw new Error("A CSV or domain-list source is required.");
          const parsed = payload.data.inputType === "csv_upload" ? parseLeadCsv(payload.data.rawContent) : parseDomainList(payload.data.rawContent);
          return ingestUserLeads({ ...common, inputType: payload.data.inputType, rawContent: payload.data.rawContent, fieldMapping: payload.data.inputType === "csv_upload" ? parseLeadCsv(payload.data.rawContent).mapping : undefined, valid: parsed.valid, invalid: parsed.invalid });
        })();
      const callback = result.integrationEventId ? await emitUsageFinalized(result.integrationEventId) : { delivered: false, reason: "callback_event_not_found" as const };
      return res.status(202).json({ accepted: true, jobId: result.jobId, createdCount: result.createdCount, duplicateCount: result.duplicateCount, callback });
    } catch (error) {
      console.error("Gbolix control-plane intake failed", { code: "GBOLIX_INGESTION_FAILED", error: error instanceof Error ? error.message : "unknown_error" });
      return res.status(500).json({ error: "GBOLIX_INGESTION_FAILED", message: error instanceof Error ? error.message : "Unable to process Gbolix Leads request" });
    }
  });

  app.post("/api/integrations/gbolix/leads/results", async (req: Request, res: Response) => {
    const payload = resultsSchema.safeParse(req.body);
    if (!payload.success) return res.status(400).json({ error: "INVALID_GBOLIX_RESULTS_REQUEST", details: payload.error.flatten() });
    if (!verifySignedPayload(req, payload.data)) return res.status(401).json({ error: "GBOLIX_SIGNATURE_INVALID" });
    try {
      return res.json(await getWorkspaceRequestResults(payload.data));
    } catch (error) {
      return res.status(404).json({ error: "GBOLIX_RESULTS_NOT_FOUND", message: error instanceof Error ? error.message : "Unable to retrieve Lead results" });
    }
  });

  app.post("/api/integrations/gbolix/leads/exports", async (req: Request, res: Response) => {
    const payload = resultsSchema.safeParse(req.body);
    if (!payload.success) return res.status(400).json({ error: "INVALID_GBOLIX_EXPORT_REQUEST", details: payload.error.flatten() });
    if (!verifySignedPayload(req, payload.data)) return res.status(401).json({ error: "GBOLIX_SIGNATURE_INVALID" });
    try {
      const exportRecord = await createWorkspaceRequestExport(payload.data);
      const download = await authorizeWorkspaceExportDownload({ exportId: exportRecord.exportId, externalWorkspaceId: payload.data.externalWorkspaceId, actorId: payload.data.actorId });
      return res.json({ ...exportRecord, downloadUrl: download.url, downloadExpiresAt: download.expiresAt });
    } catch (error) {
      return res.status(404).json({ error: "GBOLIX_EXPORT_NOT_FOUND", message: error instanceof Error ? error.message : "Unable to create Lead export" });
    }
  });
}
