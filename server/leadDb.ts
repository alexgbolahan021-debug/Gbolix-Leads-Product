import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  auditEvents,
  evidenceRecords,
  exportAuditEvents,
  exports,
  externalWorkspaces,
  identityMatches,
  ingestionSources,
  integrationEvents,
  leadCategoryDefinitions,
  leadFieldObservations,
  leadJobs,
  leadMergeEvents,
  leadScoreComponents,
  leadScores,
  leads,
  scoreVersions,
  sourceDefinitions,
  verificationChecks,
} from "../drizzle/schema";
import type { LeadInput } from "@shared/leadContracts";
import { getDb } from "./db";
import { compareLeadIdentity } from "./leads/matching";
import { normalizeDomain, normalizeEmail, normalizeLocation, normalizeName, normalizePhone } from "./leads/normalization";
import { scoreLead } from "./leads/scoring";
import { verifyEmailAndWebsite, verifyEmailDomainExistence } from "./leads/verification";
import { retrieveWebsiteEvidence } from "./leads/website";
import { inferLeadIntelligence } from "./leads/ai";
import { aiInferenceObservationPolicy, buildCrossSourceVerificationCheck, exportAccessDecision, resolveCrossSourceValue, usageEventIdempotencyKey } from "./leads/policy";
import { storageGetSignedUrl, storagePut } from "./storage";

const USER_SOURCE_DEFINITION_ID = "source-user-provided-v1";
const OPENSTREETMAP_PILOT_SOURCE_DEFINITION_ID = "source-openstreetmap-pilot-v1";
const GOOGLE_PLACES_SOURCE_DEFINITION_ID = "source-google-places-v1";
const SCORE_VERSION_ID = "score-opportunity-v1";
const OPERATOR_WORKSPACE_ID = "gbolix-operator-mock";

type PipelineInput = {
  workspaceId?: string;
  customerId?: string;
  actorId?: string;
  externalRequestId: string;
  creditAuthorizationId?: string;
  label: string;
  inputType: "csv_upload" | "domain_list" | "openstreetmap_discovery";
  rawContent: string;
  fieldMapping?: Record<string, string>;
  categoryCode?: string;
  valid: LeadInput[];
  invalid: Array<{ row: number; message: string }>;
  sourceDefinitionId?: string;
  evidenceType?: string;
  observationOrigin?: string;
  sourceMetadata?: Record<string, unknown>;
  provenance?: Array<{ sourceUrl?: string; retrievedAt: string; retentionClass: string }>;
  operation?: string;
};

function id(prefix: string) {
  return `${prefix}_${nanoid(21)}`;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("The Gbolix Leads database is unavailable.");
  return db;
}

export async function ensureEngineConfiguration(externalWorkspaceId = OPERATOR_WORKSPACE_ID, externalCustomerId?: string) {
  const db = await requireDb();
  await db.insert(externalWorkspaces).values({
    id: id("ws"),
    externalWorkspaceId,
    externalCustomerId: externalCustomerId ?? null,
    displayName: externalWorkspaceId === OPERATOR_WORKSPACE_ID ? "Gbolix operator mock workspace" : "Gbolix connected workspace",
  }).onConflictDoUpdate({ target: externalWorkspaces.externalWorkspaceId, set: { externalCustomerId: externalCustomerId ?? null, updatedAt: new Date() } });
  await db.insert(sourceDefinitions).values({
    id: USER_SOURCE_DEFINITION_ID,
    adapterKey: "user-provided-v1",
    name: "User-provided CSV and domains",
    sourceKind: "user_provided",
    approvalStatus: "approved",
    geographyStatus: "candidate",
    capabilities: { csv: true, domainList: true, evidence: "user-supplied" },
    notes: "V1 controlled source. No external discovery provider is enabled.",
  }).onConflictDoUpdate({ target: sourceDefinitions.adapterKey, set: { name: "User-provided CSV and domains", approvalStatus: "approved", updatedAt: new Date() } });
  await db.insert(sourceDefinitions).values({
    id: OPENSTREETMAP_PILOT_SOURCE_DEFINITION_ID,
    adapterKey: "openstreetmap-pilot-v1",
    name: "OpenStreetMap pilot discovery",
    sourceKind: "provider_discovery",
    approvalStatus: "approved",
    geographyStatus: "pilot_limited",
    capabilities: { categoryCityDiscovery: true, maxResultsPerRequest: 25, attribution: "© OpenStreetMap contributors" },
    notes: "User-triggered, city-required pilot. Public Overpass/Nominatim infrastructure must not be used as the scalable commercial backend.",
  }).onConflictDoUpdate({ target: sourceDefinitions.adapterKey, set: { name: "OpenStreetMap pilot discovery", approvalStatus: "approved", updatedAt: new Date() } });
  await db.insert(sourceDefinitions).values({
    id: GOOGLE_PLACES_SOURCE_DEFINITION_ID,
    adapterKey: "google-places-v1",
    name: "Google Places API (official; policy-gated)",
    sourceKind: "provider_discovery",
    approvalStatus: process.env.GOOGLE_PLACES_SOURCE_APPROVED === "true" ? "approved" : "candidate",
    geographyStatus: process.env.GOOGLE_PLACES_SOURCE_APPROVED === "true" ? "approved" : "candidate",
    capabilities: { categoryCityDiscovery: true, maxResultsPerRequest: 100, requiresFieldMask: true },
    retentionPolicy: "google-places-policy-controlled",
    notes: "Official Google Places API only. Do not scrape Google Maps pages or treat Places content as an unrestricted warehouse.",
  }).onConflictDoUpdate({ target: sourceDefinitions.adapterKey, set: { name: "Google Places API (official; policy-gated)", approvalStatus: process.env.GOOGLE_PLACES_SOURCE_APPROVED === "true" ? "approved" : "candidate", geographyStatus: process.env.GOOGLE_PLACES_SOURCE_APPROVED === "true" ? "approved" : "candidate", updatedAt: new Date() } });
  for (const category of [
    { code: "restaurants", label: "Restaurants", profile: "restaurant-opportunity-v1" },
    { code: "real-estate", label: "Real estate", profile: "real-estate-opportunity-v1" },
  ]) {
    await db.insert(leadCategoryDefinitions).values({ id: id("cat"), code: category.code, label: category.label, scoringProfile: category.profile }).onConflictDoUpdate({ target: leadCategoryDefinitions.code, set: { label: category.label, scoringProfile: category.profile, status: "active" } });
    await db.insert(scoreVersions).values({ id: `${SCORE_VERSION_ID}-${category.code}`, version: "opportunity-v1", categoryCode: category.code, definition: { category: category.code, deterministic: true, components: ["digital_gap", "contactability", "activity", "data_quality"] } }).onConflictDoUpdate({ target: [scoreVersions.version, scoreVersions.categoryCode], set: { definition: { category: category.code, deterministic: true, components: ["digital_gap", "contactability", "activity", "data_quality"] }, status: "active" } });
  }
}

export async function listActiveCategories() {
  const db = await requireDb();
  await ensureEngineConfiguration();
  return db.select().from(leadCategoryDefinitions).where(eq(leadCategoryDefinitions.status, "active")).orderBy(leadCategoryDefinitions.label);
}

export async function ingestUserLeads(input: PipelineInput) {
  const db = await requireDb();
  const workspaceId = input.workspaceId ?? OPERATOR_WORKSPACE_ID;
  await ensureEngineConfiguration(workspaceId, input.customerId);
  if (input.categoryCode) {
    const [category] = await db.select().from(leadCategoryDefinitions).where(and(eq(leadCategoryDefinitions.code, input.categoryCode), eq(leadCategoryDefinitions.status, "active"))).limit(1);
    if (!category) throw new Error("Select an active category from the Gbolix Leads taxonomy before running the pipeline.");
  }
  const jobId = id("job");
  const sourceId = id("src");
  const sourceDefinitionId = input.sourceDefinitionId ?? USER_SOURCE_DEFINITION_ID;
  const isDiscovery = input.inputType === "openstreetmap_discovery";
  const rawObject = await storagePut(`gbolix-leads/${workspaceId}/sources/${sourceId}/original-input.${isDiscovery ? "json" : "txt"}`, input.rawContent, isDiscovery ? "application/json" : "text/plain");
  await db.insert(ingestionSources).values({
    id: sourceId,
    externalWorkspaceId: workspaceId,
    sourceDefinitionId,
    label: input.label,
    inputType: input.inputType,
    originalFileName: input.inputType === "csv_upload" ? `${input.label}.csv` : isDiscovery ? `${input.label}.json` : `${input.label}.txt`,
    originalObjectKey: rawObject.key,
    fieldMapping: input.fieldMapping ?? null,
    totalRows: input.valid.length + input.invalid.length,
    validRows: input.valid.length,
    invalidRows: input.invalid.length,
    createdBy: input.actorId ?? null,
  });
  await db.insert(leadJobs).values({
    id: jobId,
    externalWorkspaceId: workspaceId,
    externalRequestId: input.externalRequestId,
    creditAuthorizationId: input.creditAuthorizationId ?? null,
    ingestionSourceId: sourceId,
    operation: input.operation ?? "ingest",
    status: "running",
    categoryCode: input.categoryCode ?? null,
    requestPayload: { source: isDiscovery ? "provider_discovery" : "user_provided", adapterKey: isDiscovery ? String(input.sourceMetadata?.adapterKey ?? "openstreetmap-pilot-v1") : "user-provided-v1", categoryCode: input.categoryCode ?? null, ...(input.sourceMetadata ?? {}) },
    requestedCount: input.valid.length,
    startedAt: new Date(),
  });

  let duplicateCount = 0;
  let createdCount = 0;
  const createdLeadIds: string[] = [];
  for (let candidateIndex = 0; candidateIndex < input.valid.length; candidateIndex += 1) {
    const candidate = input.valid[candidateIndex]!;
    const canonicalDomain = normalizeDomain(candidate.website);
    const canonicalPhone = normalizePhone(candidate.phone);
    const canonicalEmail = normalizeEmail(candidate.email);
    const canonicalName = normalizeName(candidate.businessName);
    const canonicalLocation = normalizeLocation(candidate);
    const clauses = [
      canonicalDomain ? eq(leads.canonicalDomain, canonicalDomain) : undefined,
      canonicalPhone ? eq(leads.canonicalPhone, canonicalPhone) : undefined,
      canonicalName && canonicalLocation ? and(eq(leads.canonicalName, canonicalName), eq(leads.canonicalLocation, canonicalLocation)) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];
    const potentialMatches = clauses.length ? await db.select().from(leads).where(and(eq(leads.externalWorkspaceId, workspaceId), eq(leads.lifecycleStatus, "active"), or(...clauses))).limit(12) : [];
    const identity = { canonicalDomain, canonicalPhone, canonicalName, canonicalLocation };
    const bestMatch = potentialMatches
      .map(existing => ({ existing, result: compareLeadIdentity(identity, existing) }))
      .sort((left, right) => right.result.score - left.result.score)[0];

    if (bestMatch?.result.shouldMerge) {
      duplicateCount += 1;
      await db.insert(identityMatches).values({ id: id("match"), incomingLeadId: `source:${sourceId}:${duplicateCount}`, matchedLeadId: bestMatch.existing.id, matchState: "auto_merged", score: bestMatch.result.score, signals: bestMatch.result.signals });
      await db.insert(leadMergeEvents).values({ id: id("merge"), sourceLeadId: `source:${sourceId}:${duplicateCount}`, targetLeadId: bestMatch.existing.id, reason: `Duplicate suppression: ${bestMatch.result.signals.join(", ")}`, matchScore: bestMatch.result.score, mergeSnapshot: { candidate } });
      continue;
    }

    const leadId = id("lead");
    const verification = verifyEmailAndWebsite(canonicalEmail, candidate.website);
    await db.insert(leads).values({
      id: leadId,
      externalWorkspaceId: workspaceId,
      businessName: candidate.businessName,
      industry: candidate.industry || null,
      categoryCode: candidate.categoryCode || input.categoryCode || null,
      description: candidate.description || null,
      website: candidate.website || null,
      canonicalDomain,
      publicEmail: candidate.email || null,
      canonicalEmail,
      phone: candidate.phone || null,
      canonicalPhone,
      country: candidate.country || null,
      region: candidate.region || null,
      city: candidate.city || null,
      address: candidate.address || null,
      postalCode: candidate.postalCode || null,
      canonicalName,
      canonicalLocation: canonicalLocation || null,
      dataConfidence: verification.confidence,
    });
    const evidenceId = id("evidence");
    const recordProvenance = input.provenance?.[candidateIndex];
    await db.insert(evidenceRecords).values({ id: evidenceId, leadId, ingestionSourceId: sourceId, evidenceType: input.evidenceType ?? "user_row", sourceUrl: recordProvenance?.sourceUrl ?? null, sourceLabel: input.label, excerpt: JSON.stringify(candidate).slice(0, 8000), retrievalStatus: "captured", retentionClass: recordProvenance?.retentionClass ?? (isDiscovery ? "openstreetmap-pilot" : "workspace-controlled"), metadata: { rowSource: isDiscovery ? "provider_discovery" : "user_provided", retrievedAt: recordProvenance?.retrievedAt, ...(input.sourceMetadata ?? {}) } });
    for (const [fieldKey, value] of Object.entries(candidate)) {
      if (!value) continue;
      await db.insert(leadFieldObservations).values({ id: id("obs"), leadId, evidenceId, fieldKey, value: String(value), normalizedValue: ["website", "email", "phone"].includes(fieldKey) ? String(value).toLowerCase() : null, origin: input.observationOrigin ?? "user_provided", verificationState: fieldKey === "email" ? verification.state : "unverified", confidence: fieldKey === "email" ? verification.confidence : 0.55, isCanonical: true });
    }
    for (const check of verification.checks) {
      await db.insert(verificationChecks).values({ id: id("check"), leadId, fieldKey: check.fieldKey, checkType: check.checkType, checkState: check.checkState, confidence: check.confidence, details: check.details });
    }
    const score = scoreLead({ categoryCode: candidate.categoryCode || input.categoryCode, website: candidate.website, publicEmail: candidate.email, phone: candidate.phone, verificationState: verification.state });
    const scoreVersionId = `${SCORE_VERSION_ID}-${candidate.categoryCode || input.categoryCode || "restaurants"}`;
    const leadScoreId = id("score");
    await db.insert(leadScores).values({ id: leadScoreId, leadId, scoreVersionId, totalScore: score.totalScore });
    for (const component of score.components) {
      await db.insert(leadScoreComponents).values({ id: id("component"), leadScoreId, ...component });
    }
    createdCount += 1;
    createdLeadIds.push(leadId);
  }

  // A credit event is created only after every record has passed duplicate suppression.
  await db.update(leadJobs).set({ status: input.invalid.length ? "partially_complete" : "completed", processedCount: input.valid.length, duplicateCount, qualifiedCount: createdCount, chargeableCredits: createdCount, completedAt: new Date() }).where(eq(leadJobs.id, jobId));
  const integrationEventId = id("event");
  await db.insert(integrationEvents).values({
    id: integrationEventId,
    externalWorkspaceId: workspaceId,
    externalRequestId: input.externalRequestId,
    leadJobId: jobId,
    creditAuthorizationId: input.creditAuthorizationId ?? null,
    eventType: "lead_usage_finalized",
    idempotencyKey: usageEventIdempotencyKey(input.externalRequestId),
    payload: { newQualifiedLeads: createdCount, existingDuplicates: duplicateCount, invalidRows: input.invalid.length, chargeableCredits: createdCount, creditEmissionGuard: "dedupe_complete" },
  });
  await db.insert(auditEvents).values({ id: id("audit"), externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: isDiscovery ? "provider_discovery_ingested" : "user_source_ingested", entityType: "lead_job", entityId: jobId, metadata: { sourceId, createdCount, duplicateCount, invalidRows: input.invalid.length, adapterKey: isDiscovery ? String(input.sourceMetadata?.adapterKey ?? "openstreetmap-pilot-v1") : "user-provided-v1" } });
  return { jobId, sourceId, integrationEventId, createdCount, duplicateCount, invalid: input.invalid, leadIds: createdLeadIds, chargeableCredits: createdCount };
}

export async function ingestProviderDiscovery(input: Omit<PipelineInput, "inputType" | "rawContent" | "sourceDefinitionId" | "evidenceType" | "observationOrigin" | "operation"> & { adapterKey: string; requestMetadata: Record<string, unknown> }) {
  const isGooglePlaces = input.adapterKey === "google-places-v1";
  return ingestUserLeads({
    ...input,
    inputType: "openstreetmap_discovery",
    rawContent: JSON.stringify({ adapter: input.adapterKey, attribution: isGooglePlaces ? "Google Places API" : "© OpenStreetMap contributors", request: input.requestMetadata, records: input.valid }),
    sourceDefinitionId: isGooglePlaces ? GOOGLE_PLACES_SOURCE_DEFINITION_ID : OPENSTREETMAP_PILOT_SOURCE_DEFINITION_ID,
    evidenceType: "provider_record",
    observationOrigin: "provider_discovery",
    sourceMetadata: { adapterKey: input.adapterKey, attribution: isGooglePlaces ? "Google Places API" : "© OpenStreetMap contributors", ...input.requestMetadata },
    operation: "discover",
  });
}

export async function ingestOpenStreetMapDiscovery(input: Omit<PipelineInput, "inputType" | "rawContent" | "sourceDefinitionId" | "evidenceType" | "observationOrigin" | "operation"> & { requestMetadata: Record<string, unknown> }) {
  return ingestProviderDiscovery({ ...input, adapterKey: "openstreetmap-pilot-v1" });
}

export async function listPendingIntegrationEvents(limit = 20) {
  const db = await requireDb();
  return db.select().from(integrationEvents).where(eq(integrationEvents.deliveryState, "pending")).orderBy(asc(integrationEvents.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
}

export async function markIntegrationEventDelivery(input: { eventId: string; state: "pending" | "delivered" | "failed"; errorCode?: string }) {
  const db = await requireDb();
  const [event] = await db.select().from(integrationEvents).where(eq(integrationEvents.id, input.eventId)).limit(1);
  if (!event) return null;
  const previousPayload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
  const attempts = Number(previousPayload.deliveryAttempts ?? 0) + 1;
  await db.update(integrationEvents).set({ deliveryState: input.state, payload: { ...previousPayload, deliveryAttempts: attempts, lastDeliveryErrorCode: input.errorCode ?? null, lastDeliveryAttemptAt: new Date().toISOString() } }).where(eq(integrationEvents.id, input.eventId));
  return { ...event, deliveryAttempts: attempts };
}

export async function getWorkspaceRequestResults(input: { externalWorkspaceId: string; externalRequestId: string }) {
  const db = await requireDb();
  const [job] = await db.select().from(leadJobs).where(and(eq(leadJobs.externalWorkspaceId, input.externalWorkspaceId), eq(leadJobs.externalRequestId, input.externalRequestId))).limit(1);
  if (!job) throw new Error("The requested Lead job is not available in this workspace.");
  if (!job.ingestionSourceId) throw new Error("The Lead job does not have a persisted source.");

  const sourceEvidence = await db.select({ leadId: evidenceRecords.leadId }).from(evidenceRecords).where(eq(evidenceRecords.ingestionSourceId, job.ingestionSourceId));
  const leadIds = Array.from(new Set(sourceEvidence.map(record => record.leadId)));
  const leadRows = leadIds.length
    ? await db.select().from(leads).where(and(eq(leads.externalWorkspaceId, input.externalWorkspaceId), eq(leads.lifecycleStatus, "active"), inArray(leads.id, leadIds))).orderBy(desc(leads.createdAt)).limit(50_000)
    : [];
  const rows = await Promise.all(leadRows.map(async lead => {
    const [latestScore] = await db.select().from(leadScores).where(eq(leadScores.leadId, lead.id)).orderBy(desc(leadScores.calculatedAt)).limit(1);
    return {
      id: lead.id,
      businessName: lead.businessName,
      categoryCode: lead.categoryCode,
      website: lead.website,
      publicEmail: lead.publicEmail,
      phone: lead.phone,
      country: lead.country,
      region: lead.region,
      city: lead.city,
      dataConfidence: lead.dataConfidence,
      score: latestScore?.totalScore ?? null,
      scoreVersion: latestScore?.scoreVersionId ?? null,
    };
  }));

  return {
    job: {
      id: job.id,
      status: job.status,
      requestedCount: job.requestedCount,
      processedCount: job.processedCount,
      qualifiedCount: job.qualifiedCount,
      duplicateCount: job.duplicateCount,
      completedAt: job.completedAt,
    },
    leadIds: rows.map(lead => lead.id),
    leads: rows,
  };
}

export async function createWorkspaceRequestExport(input: { externalWorkspaceId: string; externalRequestId: string; actorId?: string }) {
  const results = await getWorkspaceRequestResults(input);
  const exportRecord = await createWorkspaceExport({
    externalWorkspaceId: input.externalWorkspaceId,
    externalRequestId: input.externalRequestId,
    actorId: input.actorId,
    leadIds: results.leadIds,
  });
  return { ...exportRecord, job: results.job };
}

export async function listOperatorLeads(externalWorkspaceId = OPERATOR_WORKSPACE_ID) {
  const db = await requireDb();
  const rows = await db.select().from(leads).where(and(eq(leads.externalWorkspaceId, externalWorkspaceId), eq(leads.lifecycleStatus, "active"))).orderBy(desc(leads.createdAt)).limit(100);
  const details = await Promise.all(rows.map(async lead => {
    const [score] = await db.select().from(leadScores).where(eq(leadScores.leadId, lead.id)).orderBy(desc(leadScores.calculatedAt)).limit(1);
    const [observation] = await db.select().from(leadFieldObservations).where(and(eq(leadFieldObservations.leadId, lead.id), eq(leadFieldObservations.fieldKey, "email"))).orderBy(desc(leadFieldObservations.observedAt)).limit(1);
    return { ...lead, score: score?.totalScore ?? 0, emailState: observation?.verificationState ?? "unavailable" };
  }));
  return details;
}

export async function listOperatorJobs(externalWorkspaceId = OPERATOR_WORKSPACE_ID) {
  const db = await requireDb();
  return db.select().from(leadJobs).where(eq(leadJobs.externalWorkspaceId, externalWorkspaceId)).orderBy(desc(leadJobs.createdAt)).limit(20);
}

export async function listOperatorExports(externalWorkspaceId = OPERATOR_WORKSPACE_ID) {
  const db = await requireDb();
  return db.select().from(exports).where(eq(exports.externalWorkspaceId, externalWorkspaceId)).orderBy(desc(exports.createdAt)).limit(12);
}

export async function getLeadDetail(leadId: string, externalWorkspaceId = OPERATOR_WORKSPACE_ID) {
  const db = await requireDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.externalWorkspaceId, externalWorkspaceId))).limit(1);
  if (!lead) return null;
  const [observations, evidence, checks, scores] = await Promise.all([
    db.select().from(leadFieldObservations).where(eq(leadFieldObservations.leadId, leadId)).orderBy(desc(leadFieldObservations.observedAt)),
    db.select().from(evidenceRecords).where(eq(evidenceRecords.leadId, leadId)).orderBy(desc(evidenceRecords.retrievedAt)),
    db.select().from(verificationChecks).where(eq(verificationChecks.leadId, leadId)).orderBy(desc(verificationChecks.checkedAt)),
    db.select().from(leadScores).where(eq(leadScores.leadId, leadId)).orderBy(desc(leadScores.calculatedAt)).limit(1),
  ]);
  const components = scores[0] ? await db.select().from(leadScoreComponents).where(eq(leadScoreComponents.leadScoreId, scores[0].id)) : [];
  return { lead, observations, evidence, checks, score: scores[0] ?? null, components };
}

async function recordLatestScore(input: {
  leadId: string;
  categoryCode?: string | null;
  website?: string | null;
  publicEmail?: string | null;
  phone?: string | null;
  verificationState: "verified" | "partially_verified" | "unverified" | "conflicting" | "unavailable";
  hasBookingSignal?: boolean;
  hasSocialSignal?: boolean;
  hasEcommerceSignal?: boolean;
}) {
  const db = await requireDb();
  const score = scoreLead(input);
  const scoreVersionId = `${SCORE_VERSION_ID}-${input.categoryCode || "restaurants"}`;
  const leadScoreId = id("score");
  await db.insert(leadScores).values({ id: leadScoreId, leadId: input.leadId, scoreVersionId, totalScore: score.totalScore });
  for (const component of score.components) {
    await db.insert(leadScoreComponents).values({ id: id("component"), leadScoreId, ...component });
  }
  return score;
}

export async function enrichLeadFromWebsite(input: { leadId: string; externalWorkspaceId?: string; actorId?: string }) {
  const db = await requireDb();
  const workspaceId = input.externalWorkspaceId ?? OPERATOR_WORKSPACE_ID;
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, input.leadId), eq(leads.externalWorkspaceId, workspaceId))).limit(1);
  if (!lead) throw new Error("Lead not found in the requested workspace.");
  const websiteEvidence = await retrieveWebsiteEvidence(lead.website);
  const evidenceId = id("evidence");
  await db.insert(evidenceRecords).values({
    id: evidenceId,
    leadId: lead.id,
    evidenceType: "website_page",
    sourceUrl: websiteEvidence.sourceUrl || null,
    sourceLabel: "Public business website",
    pageTitle: websiteEvidence.pageTitle,
    excerpt: websiteEvidence.excerpt,
    contentHash: websiteEvidence.contentHash,
    retrievalStatus: websiteEvidence.retrievalStatus,
    retentionClass: "public-page-evidence",
    metadata: {
      hasSocialSignal: websiteEvidence.hasSocialSignal,
      hasBookingSignal: websiteEvidence.hasBookingSignal,
      hasEcommerceSignal: websiteEvidence.hasEcommerceSignal,
      error: websiteEvidence.error ?? null,
    },
  });
  if (websiteEvidence.retrievalStatus !== "captured") {
    await db.insert(auditEvents).values({ id: id("audit"), externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "website_enrichment_failed", entityType: "lead", entityId: lead.id, metadata: { reason: websiteEvidence.error ?? "retrieval_failed" } });
    return { captured: false, evidenceId, error: websiteEvidence.error ?? "Website evidence was not captured." };
  }

  const websiteEmail = websiteEvidence.publicEmails[0] ?? null;
  const websitePhone = websiteEvidence.phones[0] ?? null;
  for (const [fieldKey, value] of [["publicEmail", websiteEmail], ["phone", websitePhone]] as const) {
    if (!value) continue;
    const verification = fieldKey === "publicEmail" ? verifyEmailAndWebsite(value, lead.website) : null;
    const normalizedSourceValue = fieldKey === "publicEmail" ? normalizeEmail(value) : normalizePhone(value);
    const existingCanonicalValue = fieldKey === "publicEmail" ? lead.canonicalEmail : lead.canonicalPhone;
    const crossSource = resolveCrossSourceValue(fieldKey, existingCanonicalValue, normalizedSourceValue);
    await db.insert(leadFieldObservations).values({
      id: id("obs"),
      leadId: lead.id,
      evidenceId,
      fieldKey,
      value,
      normalizedValue: value.toLowerCase(),
      origin: "website",
      verificationState: crossSource?.state ?? verification?.state ?? "partially_verified",
      confidence: crossSource?.confidence ?? verification?.confidence ?? 0.72,
      isCanonical: false,
    });
    if (verification) {
      for (const check of verification.checks) {
        await db.insert(verificationChecks).values({ id: id("check"), leadId: lead.id, fieldKey: check.fieldKey, checkType: check.checkType, checkState: check.checkState, confidence: check.confidence, details: check.details });
      }
      const domainCheck = await verifyEmailDomainExistence(value);
      await db.insert(verificationChecks).values({ id: id("check"), leadId: lead.id, fieldKey: domainCheck.fieldKey, checkType: domainCheck.checkType, checkState: domainCheck.checkState, confidence: domainCheck.confidence, details: domainCheck.details });
    }
    const crossSourceCheck = buildCrossSourceVerificationCheck(fieldKey, existingCanonicalValue, normalizedSourceValue);
    await db.insert(verificationChecks).values({ id: id("check"), leadId: lead.id, ...crossSourceCheck });
  }

  // Website evidence may fill an empty contact field, but it never overwrites an existing user or verified field.
  const update: Partial<typeof leads.$inferInsert> = {};
  if (!lead.publicEmail && websiteEmail) {
    update.publicEmail = websiteEmail;
    update.canonicalEmail = normalizeEmail(websiteEmail);
  }
  if (!lead.phone && websitePhone) {
    update.phone = websitePhone;
    update.canonicalPhone = normalizePhone(websitePhone);
  }
  if (Object.keys(update).length) await db.update(leads).set(update).where(eq(leads.id, lead.id));
  const verificationState = websiteEmail ? resolveCrossSourceValue("publicEmail", lead.canonicalEmail, normalizeEmail(websiteEmail)).state : lead.publicEmail ? "unverified" : "unavailable";
  const score = await recordLatestScore({ leadId: lead.id, categoryCode: lead.categoryCode, website: lead.website, publicEmail: lead.publicEmail ?? websiteEmail, phone: lead.phone ?? websitePhone, verificationState, hasBookingSignal: websiteEvidence.hasBookingSignal, hasSocialSignal: websiteEvidence.hasSocialSignal, hasEcommerceSignal: websiteEvidence.hasEcommerceSignal });
  await db.insert(auditEvents).values({ id: id("audit"), externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "website_enrichment_completed", entityType: "lead", entityId: lead.id, metadata: { evidenceId, score: score.totalScore } });
  return { captured: true, evidenceId, websiteEvidence, score };
}

export async function inferLeadFromEvidence(input: { leadId: string; externalWorkspaceId?: string; actorId?: string }) {
  const db = await requireDb();
  const workspaceId = input.externalWorkspaceId ?? OPERATOR_WORKSPACE_ID;
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, input.leadId), eq(leads.externalWorkspaceId, workspaceId))).limit(1);
  if (!lead) throw new Error("Lead not found in the requested workspace.");
  const evidence = await db.select().from(evidenceRecords).where(and(eq(evidenceRecords.leadId, lead.id), eq(evidenceRecords.evidenceType, "website_page"), eq(evidenceRecords.retrievalStatus, "captured"))).orderBy(desc(evidenceRecords.retrievedAt)).limit(1);
  const latestEvidence = evidence[0];
  if (!latestEvidence?.excerpt) throw new Error("Retrieve public website evidence before requesting AI inference.");
  const { model, inference } = await inferLeadIntelligence(latestEvidence.excerpt);
  const pairs = [
    ["aiIndustry", inference.industry],
    ["aiServices", inference.services.join(" | ")],
    ["aiWebsiteQualitySignals", inference.websiteQualitySignals.join(" | ")],
    ["aiOpportunityTags", inference.opportunityTags.join(" | ")],
    ["aiRationale", inference.rationale],
  ] as const;
  for (const [fieldKey, value] of pairs) {
    if (!value) continue;
    await db.insert(leadFieldObservations).values({ id: id("obs"), leadId: lead.id, evidenceId: latestEvidence.id, fieldKey, value, normalizedValue: null, ...aiInferenceObservationPolicy, confidence: inference.confidence });
  }
  await db.insert(auditEvents).values({ id: id("audit"), externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "ai_inference_completed", entityType: "lead", entityId: lead.id, metadata: { model, evidenceId: latestEvidence.id, confidence: inference.confidence, label: "AI_INFERRED_NEVER_VERIFIED" } });
  return { model, evidenceId: latestEvidence.id, inference };
}

export async function createWorkspaceExport(input: { externalWorkspaceId?: string; actorId?: string; externalRequestId: string; leadIds: string[] }) {
  const db = await requireDb();
  const workspaceId = input.externalWorkspaceId ?? OPERATOR_WORKSPACE_ID;
  const selectedIds = Array.from(new Set(input.leadIds)).slice(0, 500);
  const leadRows = selectedIds.length ? await db.select().from(leads).where(and(eq(leads.externalWorkspaceId, workspaceId), inArray(leads.id, selectedIds))) : [];
  const scoredLeadRows = await Promise.all(leadRows.map(async lead => {
    const [latestScore] = await db.select().from(leadScores).where(eq(leadScores.leadId, lead.id)).orderBy(desc(leadScores.calculatedAt)).limit(1);
    const components = latestScore ? await db.select().from(leadScoreComponents).where(eq(leadScoreComponents.leadScoreId, latestScore.id)).orderBy(leadScoreComponents.id) : [];
    return { lead, latestScore, reasonCodes: components.map(component => component.reasonCode).filter(Boolean).join(" | ") };
  }));
  const exportId = id("export");
  const csv = ["Business,Category,Website,Email,Phone,Country,Region,City,LeadScore,ScoreVersion,ScoreReasonCodes", ...scoredLeadRows.map(({ lead, latestScore, reasonCodes }) => [lead.businessName, lead.categoryCode ?? "", lead.website ?? "", lead.publicEmail ?? "", lead.phone ?? "", lead.country ?? "", lead.region ?? "", lead.city ?? "", latestScore?.totalScore ?? "", latestScore?.scoreVersionId ?? "", reasonCodes].map(value => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\n");
  const object = await storagePut(`gbolix-leads/${workspaceId}/exports/${exportId}/leads.csv`, csv, "text/csv");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(exports).values({ id: exportId, externalWorkspaceId: workspaceId, requestedBy: input.actorId ?? null, format: "csv", status: "ready", selectedLeadIds: leadRows.map(lead => lead.id), leadCount: leadRows.length, objectKey: object.key, storageUrl: object.url, expiresAt });
  await db.insert(exportAuditEvents).values({ id: id("export_audit"), exportId, externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "created", metadata: { requestedCount: selectedIds.length, deliveredCount: leadRows.length, expiresAt: expiresAt.toISOString() } });
  await db.insert(integrationEvents).values({ id: id("event"), externalWorkspaceId: workspaceId, externalRequestId: input.externalRequestId, eventType: "lead_export_ready", idempotencyKey: `export:${input.externalRequestId}:${exportId}`, payload: { exportId, leadCount: leadRows.length, expiresAt: expiresAt.toISOString() } });
  return { exportId, expiresAt, leadCount: leadRows.length };
}

export async function authorizeWorkspaceExportDownload(input: { exportId: string; externalWorkspaceId?: string; actorId?: string }) {
  const db = await requireDb();
  const workspaceId = input.externalWorkspaceId ?? OPERATOR_WORKSPACE_ID;
  const [exportRecord] = await db.select().from(exports).where(and(eq(exports.id, input.exportId), eq(exports.externalWorkspaceId, workspaceId))).limit(1);
  if (!exportRecord) {
    await db.insert(exportAuditEvents).values({ id: id("export_audit"), exportId: input.exportId, externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "denied", metadata: { reason: "workspace_mismatch_or_missing" } });
    throw new Error("This export is not available in the current workspace.");
  }
  const expiresAt = exportRecord.expiresAt;
  const decision = exportAccessDecision({ requestedWorkspaceId: workspaceId, exportWorkspaceId: exportRecord.externalWorkspaceId, status: exportRecord.status, expiresAt });
  if (!decision.allowed || !exportRecord.objectKey || !expiresAt) {
    await db.update(exports).set({ status: "expired" }).where(eq(exports.id, exportRecord.id));
    await db.insert(exportAuditEvents).values({ id: id("export_audit"), exportId: exportRecord.id, externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "expired", metadata: { expiresAt: exportRecord.expiresAt?.toISOString() ?? null } });
    throw new Error(decision.reason === "workspace_mismatch" ? "This export is not available in the current workspace." : "This export has expired. Create a new workspace-scoped export to continue.");
  }
  await db.insert(exportAuditEvents).values({ id: id("export_audit"), exportId: exportRecord.id, externalWorkspaceId: workspaceId, actorId: input.actorId ?? null, action: "downloaded", metadata: { expiresAt: expiresAt.toISOString() } });
  return { url: await storageGetSignedUrl(exportRecord.objectKey), expiresAt };
}
