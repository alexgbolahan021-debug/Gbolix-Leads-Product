import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(), openId: varchar("openId", { length: 64 }).notNull().unique(), name: text("name"), email: varchar("email", { length: 320 }), loginMethod: varchar("loginMethod", { length: 64 }), role: varchar("role", { length: 16 }).notNull().default("user"), createdAt: createdAt(), updatedAt: updatedAt(), lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export const externalWorkspaces = pgTable("external_workspaces", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), externalCustomerId: varchar("externalCustomerId", { length: 128 }), displayName: varchar("displayName", { length: 255 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("active"), createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [uniqueIndex("external_workspaces_external_id_unique").on(table.externalWorkspaceId)]);

export const sourceDefinitions = pgTable("source_definitions", {
  id: varchar("id", { length: 36 }).primaryKey(), adapterKey: varchar("adapterKey", { length: 96 }).notNull(), name: varchar("name", { length: 255 }).notNull(), sourceKind: varchar("sourceKind", { length: 32 }).notNull(), approvalStatus: varchar("approvalStatus", { length: 16 }).notNull().default("candidate"), geographyStatus: varchar("geographyStatus", { length: 16 }).notNull().default("candidate"), capabilities: jsonb("capabilities"), retentionPolicy: varchar("retentionPolicy", { length: 255 }).notNull().default("workspace-controlled"), notes: text("notes"), createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [uniqueIndex("source_definitions_adapter_key_unique").on(table.adapterKey)]);

export const leadCategoryDefinitions = pgTable("lead_category_definitions", {
  id: varchar("id", { length: 36 }).primaryKey(), code: varchar("code", { length: 96 }).notNull(), label: varchar("label", { length: 255 }).notNull(), parentCode: varchar("parentCode", { length: 96 }), status: varchar("status", { length: 16 }).notNull().default("active"), scoringProfile: varchar("scoringProfile", { length: 96 }).notNull(), createdAt: createdAt(),
}, table => [uniqueIndex("lead_category_definitions_code_unique").on(table.code)]);

export const ingestionSources = pgTable("ingestion_sources", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), sourceDefinitionId: varchar("sourceDefinitionId", { length: 36 }).notNull(), label: varchar("label", { length: 255 }).notNull(), inputType: varchar("inputType", { length: 32 }).notNull(), originalFileName: varchar("originalFileName", { length: 255 }), originalObjectKey: varchar("originalObjectKey", { length: 512 }), fieldMapping: jsonb("fieldMapping"), totalRows: integer("totalRows").notNull().default(0), validRows: integer("validRows").notNull().default(0), invalidRows: integer("invalidRows").notNull().default(0), createdBy: varchar("createdBy", { length: 128 }), createdAt: createdAt(),
}, table => [index("ingestion_sources_workspace_idx").on(table.externalWorkspaceId)]);

export const leadJobs = pgTable("lead_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), externalRequestId: varchar("externalRequestId", { length: 128 }).notNull(), creditAuthorizationId: varchar("creditAuthorizationId", { length: 128 }), ingestionSourceId: varchar("ingestionSourceId", { length: 36 }), operation: varchar("operation", { length: 24 }).notNull(), status: varchar("status", { length: 32 }).notNull().default("queued"), categoryCode: varchar("categoryCode", { length: 96 }), requestPayload: jsonb("requestPayload"), requestedCount: integer("requestedCount").notNull().default(0), processedCount: integer("processedCount").notNull().default(0), duplicateCount: integer("duplicateCount").notNull().default(0), qualifiedCount: integer("qualifiedCount").notNull().default(0), chargeableCredits: integer("chargeableCredits").notNull().default(0), errorMessage: text("errorMessage"), startedAt: timestamp("startedAt", { withTimezone: true }), completedAt: timestamp("completedAt", { withTimezone: true }), createdAt: createdAt(),
}, table => [uniqueIndex("lead_jobs_external_request_unique").on(table.externalRequestId), index("lead_jobs_workspace_status_idx").on(table.externalWorkspaceId, table.status)]);

export const leads = pgTable("leads", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), businessName: varchar("businessName", { length: 320 }).notNull(), legalName: varchar("legalName", { length: 320 }), industry: varchar("industry", { length: 255 }), categoryCode: varchar("categoryCode", { length: 96 }), description: text("description"), website: varchar("website", { length: 2048 }), canonicalDomain: varchar("canonicalDomain", { length: 255 }), publicEmail: varchar("publicEmail", { length: 320 }), canonicalEmail: varchar("canonicalEmail", { length: 320 }), phone: varchar("phone", { length: 64 }), canonicalPhone: varchar("canonicalPhone", { length: 32 }), country: varchar("country", { length: 2 }), region: varchar("region", { length: 128 }), city: varchar("city", { length: 128 }), address: text("address"), postalCode: varchar("postalCode", { length: 32 }), canonicalName: varchar("canonicalName", { length: 320 }).notNull(), canonicalLocation: varchar("canonicalLocation", { length: 512 }), lifecycleStatus: varchar("lifecycleStatus", { length: 16 }).notNull().default("active"), dataConfidence: doublePrecision("dataConfidence").notNull().default(0), lastVerifiedAt: timestamp("lastVerifiedAt", { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [index("leads_workspace_domain_idx").on(table.externalWorkspaceId, table.canonicalDomain), index("leads_workspace_phone_idx").on(table.externalWorkspaceId, table.canonicalPhone), index("leads_workspace_name_location_idx").on(table.externalWorkspaceId, table.canonicalName, table.canonicalLocation)]);

export const evidenceRecords = pgTable("evidence_records", {
  id: varchar("id", { length: 36 }).primaryKey(), leadId: varchar("leadId", { length: 36 }).notNull(), ingestionSourceId: varchar("ingestionSourceId", { length: 36 }), evidenceType: varchar("evidenceType", { length: 24 }).notNull(), sourceUrl: varchar("sourceUrl", { length: 2048 }), sourceLabel: varchar("sourceLabel", { length: 255 }).notNull(), pageTitle: varchar("pageTitle", { length: 512 }), excerpt: text("excerpt"), contentHash: varchar("contentHash", { length: 128 }), retrievalStatus: varchar("retrievalStatus", { length: 24 }).notNull().default("captured"), retrievedAt: timestamp("retrievedAt", { withTimezone: true }).defaultNow().notNull(), retentionClass: varchar("retentionClass", { length: 96 }).notNull().default("workspace-controlled"), metadata: jsonb("metadata"),
}, table => [index("evidence_records_lead_idx").on(table.leadId)]);

export const leadFieldObservations = pgTable("lead_field_observations", {
  id: varchar("id", { length: 36 }).primaryKey(), leadId: varchar("leadId", { length: 36 }).notNull(), evidenceId: varchar("evidenceId", { length: 36 }), fieldKey: varchar("fieldKey", { length: 128 }).notNull(), value: text("value").notNull(), normalizedValue: text("normalizedValue"), origin: varchar("origin", { length: 24 }).notNull(), verificationState: varchar("verificationState", { length: 24 }).notNull().default("unverified"), confidence: doublePrecision("confidence").notNull().default(0), isCanonical: boolean("isCanonical").notNull().default(false), observedAt: timestamp("observedAt", { withTimezone: true }).defaultNow().notNull(), supersededAt: timestamp("supersededAt", { withTimezone: true }),
}, table => [index("lead_observations_lead_field_idx").on(table.leadId, table.fieldKey)]);

export const identityMatches = pgTable("identity_matches", {
  id: varchar("id", { length: 36 }).primaryKey(), incomingLeadId: varchar("incomingLeadId", { length: 36 }).notNull(), matchedLeadId: varchar("matchedLeadId", { length: 36 }).notNull(), matchState: varchar("matchState", { length: 16 }).notNull(), score: doublePrecision("score").notNull(), signals: jsonb("signals").notNull(), createdAt: createdAt(),
}, table => [index("identity_matches_incoming_idx").on(table.incomingLeadId)]);

export const leadMergeEvents = pgTable("lead_merge_events", {
  id: varchar("id", { length: 36 }).primaryKey(), sourceLeadId: varchar("sourceLeadId", { length: 36 }).notNull(), targetLeadId: varchar("targetLeadId", { length: 36 }).notNull(), reason: varchar("reason", { length: 512 }).notNull(), matchScore: doublePrecision("matchScore").notNull(), mergeSnapshot: jsonb("mergeSnapshot"), createdAt: createdAt(),
}, table => [index("lead_merge_events_target_idx").on(table.targetLeadId)]);

export const verificationChecks = pgTable("verification_checks", {
  id: varchar("id", { length: 36 }).primaryKey(), leadId: varchar("leadId", { length: 36 }).notNull(), fieldKey: varchar("fieldKey", { length: 128 }).notNull(), checkType: varchar("checkType", { length: 32 }).notNull(), checkState: varchar("checkState", { length: 16 }).notNull(), confidence: doublePrecision("confidence").notNull().default(0), details: jsonb("details"), checkedAt: timestamp("checkedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("verification_checks_lead_field_idx").on(table.leadId, table.fieldKey)]);

export const scoreVersions = pgTable("score_versions", {
  id: varchar("id", { length: 36 }).primaryKey(), version: varchar("version", { length: 96 }).notNull(), categoryCode: varchar("categoryCode", { length: 96 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("active"), definition: jsonb("definition").notNull(), createdAt: createdAt(),
}, table => [uniqueIndex("score_versions_version_category_unique").on(table.version, table.categoryCode)]);

export const leadScores = pgTable("lead_scores", {
  id: varchar("id", { length: 36 }).primaryKey(), leadId: varchar("leadId", { length: 36 }).notNull(), scoreVersionId: varchar("scoreVersionId", { length: 36 }).notNull(), totalScore: integer("totalScore").notNull(), calculatedAt: timestamp("calculatedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("lead_scores_lead_idx").on(table.leadId)]);

export const leadScoreComponents = pgTable("lead_score_components", {
  id: varchar("id", { length: 36 }).primaryKey(), leadScoreId: varchar("leadScoreId", { length: 36 }).notNull(), componentKey: varchar("componentKey", { length: 128 }).notNull(), points: integer("points").notNull(), reasonCode: varchar("reasonCode", { length: 128 }).notNull(), explanation: varchar("explanation", { length: 512 }).notNull(),
}, table => [index("lead_score_components_score_idx").on(table.leadScoreId)]);

export const integrationEvents = pgTable("integration_events", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), externalRequestId: varchar("externalRequestId", { length: 128 }).notNull(), leadJobId: varchar("leadJobId", { length: 36 }), creditAuthorizationId: varchar("creditAuthorizationId", { length: 128 }), eventType: varchar("eventType", { length: 32 }).notNull(), idempotencyKey: varchar("idempotencyKey", { length: 192 }).notNull(), deliveryState: varchar("deliveryState", { length: 16 }).notNull().default("pending"), payload: jsonb("payload").notNull(), createdAt: createdAt(),
}, table => [uniqueIndex("integration_events_idempotency_unique").on(table.idempotencyKey)]);

export const exports = pgTable("exports", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), leadJobId: varchar("leadJobId", { length: 36 }), requestedBy: varchar("requestedBy", { length: 128 }), format: varchar("format", { length: 16 }).notNull().default("csv"), status: varchar("status", { length: 16 }).notNull().default("generating"), selectedLeadIds: jsonb("selectedLeadIds").notNull(), leadCount: integer("leadCount").notNull().default(0), objectKey: varchar("objectKey", { length: 512 }), storageUrl: varchar("storageUrl", { length: 2048 }), expiresAt: timestamp("expiresAt", { withTimezone: true }), createdAt: createdAt(),
}, table => [index("exports_workspace_status_idx").on(table.externalWorkspaceId, table.status)]);

export const exportAuditEvents = pgTable("export_audit_events", {
  id: varchar("id", { length: 36 }).primaryKey(), exportId: varchar("exportId", { length: 36 }).notNull(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(), actorId: varchar("actorId", { length: 128 }), action: varchar("action", { length: 16 }).notNull(), metadata: jsonb("metadata"), createdAt: createdAt(),
}, table => [index("export_audit_events_export_idx").on(table.exportId)]);

export const auditEvents = pgTable("audit_events", {
  id: varchar("id", { length: 36 }).primaryKey(), externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }), actorId: varchar("actorId", { length: 128 }), action: varchar("action", { length: 128 }).notNull(), entityType: varchar("entityType", { length: 128 }).notNull(), entityId: varchar("entityId", { length: 128 }), metadata: jsonb("metadata"), createdAt: createdAt(),
}, table => [index("audit_events_workspace_created_idx").on(table.externalWorkspaceId, table.createdAt)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const discoverySourceCredentials = pgTable("discovery_source_credentials", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sourceKey: varchar("sourceKey", { length: 96 }).notNull(),
  encryptedApiKey: text("encryptedApiKey"),
  enabled: boolean("enabled").notNull().default(false),
  developmentFixtureEnabled: boolean("developmentFixtureEnabled").notNull().default(false),
  approvalStatus: varchar("approvalStatus", { length: 16 }).notNull().default("candidate"),
  priority: integer("priority").notNull().default(100),
  maxResultsPerJob: integer("maxResultsPerJob").notNull().default(100),
  dailyBudgetCents: integer("dailyBudgetCents").notNull().default(0),
  updatedAt: updatedAt(),
}, table => [uniqueIndex("discovery_source_credentials_key_unique").on(table.sourceKey)]);

export type DiscoverySourceCredential = typeof discoverySourceCredentials.$inferSelect;
