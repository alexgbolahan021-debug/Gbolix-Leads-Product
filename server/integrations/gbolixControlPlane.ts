import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { parseDomainList, parseLeadCsv } from "../leads/csv";
import { getIntegrationSecret } from "../leads/integration";
import { authorizeWorkspaceExportDownload, createWorkspaceRequestExport, getWorkspaceRequestResults, ingestUserLeads } from "../leadDb";

const intakeSchema = z.object({
  externalRequestId: z.string().trim().min(8).max(128),
  externalWorkspaceId: z.string().trim().min(1).max(128),
  externalCustomerId: z.string().trim().max(128).optional(),
  actorId: z.string().trim().max(128).optional(),
  creditAuthorizationId: z.string().trim().min(6).max(128),
  label: z.string().trim().min(1).max(255),
  inputType: z.enum(["csv_upload", "domain_list"]),
  rawContent: z.string().min(1).max(1_000_000),
  categoryCode: z.string().trim().min(1).max(96),
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

async function emitUsageFinalized(payload: { externalRequestId: string; jobId: string; createdCount: number; duplicateCount: number; creditAuthorizationId: string }) {
  const callbackUrl = process.env.GBOLIX_CONTROL_PLANE_CALLBACK_URL;
  const callbackSecret = process.env.GBOLIX_CONTROL_PLANE_CALLBACK_SECRET;
  if (!callbackUrl || !callbackSecret) return { delivered: false, reason: "callback_not_configured" as const };
  const { timestamp, body, signature } = buildGbolixUsageCallback(callbackSecret, payload);
  const response = await fetch(callbackUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Gbolix-Timestamp": timestamp, "X-Gbolix-Signature": signature }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Gbolix callback returned ${response.status}`);
  return { delivered: true as const };
}

export function registerGbolixControlPlaneRoutes(app: Express) {
  app.post("/api/integrations/gbolix/leads/ingest", async (req: Request, res: Response) => {
    const payload = intakeSchema.safeParse(req.body);
    if (!payload.success) return res.status(400).json({ error: "INVALID_GBOLIX_REQUEST", details: payload.error.flatten() });
    if (!verifySignedPayload(req, payload.data)) return res.status(401).json({ error: "GBOLIX_SIGNATURE_INVALID" });
    try {
      const parsed = payload.data.inputType === "csv_upload" ? parseLeadCsv(payload.data.rawContent) : parseDomainList(payload.data.rawContent);
      const result = await ingestUserLeads({
        workspaceId: payload.data.externalWorkspaceId,
        customerId: payload.data.externalCustomerId,
        actorId: payload.data.actorId,
        externalRequestId: payload.data.externalRequestId,
        creditAuthorizationId: payload.data.creditAuthorizationId,
        label: payload.data.label,
        inputType: payload.data.inputType,
        rawContent: payload.data.rawContent,
        fieldMapping: payload.data.inputType === "csv_upload" ? parseLeadCsv(payload.data.rawContent).mapping : undefined,
        categoryCode: payload.data.categoryCode,
        valid: parsed.valid,
        invalid: parsed.invalid,
      });
      const callback = await emitUsageFinalized({ externalRequestId: payload.data.externalRequestId, jobId: result.jobId, createdCount: result.createdCount, duplicateCount: result.duplicateCount, creditAuthorizationId: payload.data.creditAuthorizationId });
      return res.status(202).json({ accepted: true, jobId: result.jobId, createdCount: result.createdCount, duplicateCount: result.duplicateCount, callback });
    } catch (error) {
      console.error("Gbolix control-plane intake failed", error);
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
