import {
  boolean,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const externalWorkspaces = mysqlTable(
  "external_workspaces",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    externalCustomerId: varchar("externalCustomerId", { length: 128 }),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("external_workspaces_external_id_unique").on(table.externalWorkspaceId)]
);

export const sourceDefinitions = mysqlTable(
  "source_definitions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    adapterKey: varchar("adapterKey", { length: 96 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sourceKind: mysqlEnum("sourceKind", ["user_provided", "provider_adapter", "website"]).notNull(),
    approvalStatus: mysqlEnum("approvalStatus", ["approved", "candidate", "disabled"]).default("candidate").notNull(),
    geographyStatus: mysqlEnum("geographyStatus", ["candidate", "benchmarking", "approved", "degraded", "disabled"]).default("candidate").notNull(),
    capabilities: json("capabilities"),
    retentionPolicy: varchar("retentionPolicy", { length: 255 }).default("workspace-controlled").notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("source_definitions_adapter_key_unique").on(table.adapterKey)]
);

export const leadCategoryDefinitions = mysqlTable(
  "lead_category_definitions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    code: varchar("code", { length: 96 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    parentCode: varchar("parentCode", { length: 96 }),
    status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
    scoringProfile: varchar("scoringProfile", { length: 96 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("lead_category_definitions_code_unique").on(table.code)]
);

export const ingestionSources = mysqlTable(
  "ingestion_sources",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    sourceDefinitionId: varchar("sourceDefinitionId", { length: 36 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    inputType: mysqlEnum("inputType", ["csv_upload", "domain_list", "provider_adapter"]).notNull(),
    originalFileName: varchar("originalFileName", { length: 255 }),
    originalObjectKey: varchar("originalObjectKey", { length: 512 }),
    fieldMapping: json("fieldMapping"),
    totalRows: int("totalRows").default(0).notNull(),
    validRows: int("validRows").default(0).notNull(),
    invalidRows: int("invalidRows").default(0).notNull(),
    createdBy: varchar("createdBy", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("ingestion_sources_workspace_idx").on(table.externalWorkspaceId)]
);

export const leadJobs = mysqlTable(
  "lead_jobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    externalRequestId: varchar("externalRequestId", { length: 128 }).notNull(),
    creditAuthorizationId: varchar("creditAuthorizationId", { length: 128 }),
    ingestionSourceId: varchar("ingestionSourceId", { length: 36 }),
    operation: mysqlEnum("operation", ["ingest", "enrich", "verify", "score", "ai_infer", "export"]).notNull(),
    status: mysqlEnum("status", ["queued", "running", "partially_complete", "completed", "failed", "cancelled"]).default("queued").notNull(),
    categoryCode: varchar("categoryCode", { length: 96 }),
    requestPayload: json("requestPayload"),
    requestedCount: int("requestedCount").default(0).notNull(),
    processedCount: int("processedCount").default(0).notNull(),
    duplicateCount: int("duplicateCount").default(0).notNull(),
    qualifiedCount: int("qualifiedCount").default(0).notNull(),
    chargeableCredits: int("chargeableCredits").default(0).notNull(),
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("lead_jobs_external_request_unique").on(table.externalRequestId),
    index("lead_jobs_workspace_status_idx").on(table.externalWorkspaceId, table.status),
  ]
);

export const leads = mysqlTable(
  "leads",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    businessName: varchar("businessName", { length: 320 }).notNull(),
    legalName: varchar("legalName", { length: 320 }),
    industry: varchar("industry", { length: 255 }),
    categoryCode: varchar("categoryCode", { length: 96 }),
    description: text("description"),
    website: varchar("website", { length: 2048 }),
    canonicalDomain: varchar("canonicalDomain", { length: 255 }),
    publicEmail: varchar("publicEmail", { length: 320 }),
    canonicalEmail: varchar("canonicalEmail", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    canonicalPhone: varchar("canonicalPhone", { length: 32 }),
    country: varchar("country", { length: 2 }),
    region: varchar("region", { length: 128 }),
    city: varchar("city", { length: 128 }),
    address: text("address"),
    postalCode: varchar("postalCode", { length: 32 }),
    canonicalName: varchar("canonicalName", { length: 320 }).notNull(),
    canonicalLocation: varchar("canonicalLocation", { length: 512 }),
    lifecycleStatus: mysqlEnum("lifecycleStatus", ["active", "merged", "suppressed", "archived"]).default("active").notNull(),
    dataConfidence: double("dataConfidence").default(0).notNull(),
    lastVerifiedAt: timestamp("lastVerifiedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("leads_workspace_domain_idx").on(table.externalWorkspaceId, table.canonicalDomain),
    index("leads_workspace_phone_idx").on(table.externalWorkspaceId, table.canonicalPhone),
    index("leads_workspace_name_location_idx").on(table.externalWorkspaceId, table.canonicalName, table.canonicalLocation),
  ]
);

export const evidenceRecords = mysqlTable(
  "evidence_records",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    leadId: varchar("leadId", { length: 36 }).notNull(),
    ingestionSourceId: varchar("ingestionSourceId", { length: 36 }),
    evidenceType: mysqlEnum("evidenceType", ["user_row", "website_page", "provider_record", "verification"]).notNull(),
    sourceUrl: varchar("sourceUrl", { length: 2048 }),
    sourceLabel: varchar("sourceLabel", { length: 255 }).notNull(),
    pageTitle: varchar("pageTitle", { length: 512 }),
    excerpt: text("excerpt"),
    contentHash: varchar("contentHash", { length: 128 }),
    retrievalStatus: mysqlEnum("retrievalStatus", ["captured", "blocked", "failed", "not_applicable"]).default("captured").notNull(),
    retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
    retentionClass: varchar("retentionClass", { length: 96 }).default("workspace-controlled").notNull(),
    metadata: json("metadata"),
  },
  table => [index("evidence_records_lead_idx").on(table.leadId)]
);

export const leadFieldObservations = mysqlTable(
  "lead_field_observations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    leadId: varchar("leadId", { length: 36 }).notNull(),
    evidenceId: varchar("evidenceId", { length: 36 }),
    fieldKey: varchar("fieldKey", { length: 128 }).notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalizedValue"),
    origin: mysqlEnum("origin", ["user_provided", "source_api", "website", "ai_inferred"]).notNull(),
    verificationState: mysqlEnum("verificationState", ["verified", "partially_verified", "unverified", "conflicting", "unavailable"]).default("unverified").notNull(),
    confidence: double("confidence").default(0).notNull(),
    isCanonical: boolean("isCanonical").default(false).notNull(),
    observedAt: timestamp("observedAt").defaultNow().notNull(),
    supersededAt: timestamp("supersededAt"),
  },
  table => [index("lead_observations_lead_field_idx").on(table.leadId, table.fieldKey)]
);

export const identityMatches = mysqlTable(
  "identity_matches",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    incomingLeadId: varchar("incomingLeadId", { length: 36 }).notNull(),
    matchedLeadId: varchar("matchedLeadId", { length: 36 }).notNull(),
    matchState: mysqlEnum("matchState", ["auto_merged", "candidate", "rejected"]).notNull(),
    score: double("score").notNull(),
    signals: json("signals").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("identity_matches_incoming_idx").on(table.incomingLeadId)]
);

export const leadMergeEvents = mysqlTable(
  "lead_merge_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    sourceLeadId: varchar("sourceLeadId", { length: 36 }).notNull(),
    targetLeadId: varchar("targetLeadId", { length: 36 }).notNull(),
    reason: varchar("reason", { length: 512 }).notNull(),
    matchScore: double("matchScore").notNull(),
    mergeSnapshot: json("mergeSnapshot"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("lead_merge_events_target_idx").on(table.targetLeadId)]
);

export const verificationChecks = mysqlTable(
  "verification_checks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    leadId: varchar("leadId", { length: 36 }).notNull(),
    fieldKey: varchar("fieldKey", { length: 128 }).notNull(),
    checkType: mysqlEnum("checkType", ["syntax", "domain", "website_relationship", "cross_source"]).notNull(),
    checkState: mysqlEnum("checkState", ["passed", "failed", "not_run", "conflicting"]).notNull(),
    confidence: double("confidence").default(0).notNull(),
    details: json("details"),
    checkedAt: timestamp("checkedAt").defaultNow().notNull(),
  },
  table => [index("verification_checks_lead_field_idx").on(table.leadId, table.fieldKey)]
);

export const scoreVersions = mysqlTable(
  "score_versions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    version: varchar("version", { length: 96 }).notNull(),
    categoryCode: varchar("categoryCode", { length: 96 }).notNull(),
    status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
    definition: json("definition").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("score_versions_version_category_unique").on(table.version, table.categoryCode)]
);

export const leadScores = mysqlTable(
  "lead_scores",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    leadId: varchar("leadId", { length: 36 }).notNull(),
    scoreVersionId: varchar("scoreVersionId", { length: 36 }).notNull(),
    totalScore: int("totalScore").notNull(),
    calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
  },
  table => [index("lead_scores_lead_idx").on(table.leadId)]
);

export const leadScoreComponents = mysqlTable(
  "lead_score_components",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    leadScoreId: varchar("leadScoreId", { length: 36 }).notNull(),
    componentKey: varchar("componentKey", { length: 128 }).notNull(),
    points: int("points").notNull(),
    reasonCode: varchar("reasonCode", { length: 128 }).notNull(),
    explanation: varchar("explanation", { length: 512 }).notNull(),
  },
  table => [index("lead_score_components_score_idx").on(table.leadScoreId)]
);

export const integrationEvents = mysqlTable(
  "integration_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    externalRequestId: varchar("externalRequestId", { length: 128 }).notNull(),
    leadJobId: varchar("leadJobId", { length: 36 }),
    creditAuthorizationId: varchar("creditAuthorizationId", { length: 128 }),
    eventType: mysqlEnum("eventType", ["lead_job_created", "lead_job_progressed", "lead_usage_finalized", "lead_usage_released", "lead_job_completed", "lead_job_failed", "lead_export_ready"]).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 192 }).notNull(),
    deliveryState: mysqlEnum("deliveryState", ["pending", "delivered", "failed"]).default("pending").notNull(),
    payload: json("payload").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("integration_events_idempotency_unique").on(table.idempotencyKey)]
);

export const exports = mysqlTable(
  "exports",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    leadJobId: varchar("leadJobId", { length: 36 }),
    requestedBy: varchar("requestedBy", { length: 128 }),
    format: mysqlEnum("format", ["csv"]).default("csv").notNull(),
    status: mysqlEnum("status", ["generating", "ready", "expired", "failed"]).default("generating").notNull(),
    selectedLeadIds: json("selectedLeadIds").notNull(),
    leadCount: int("leadCount").default(0).notNull(),
    objectKey: varchar("objectKey", { length: 512 }),
    storageUrl: varchar("storageUrl", { length: 2048 }),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("exports_workspace_status_idx").on(table.externalWorkspaceId, table.status)]
);

export const exportAuditEvents = mysqlTable(
  "export_audit_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    exportId: varchar("exportId", { length: 36 }).notNull(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }).notNull(),
    actorId: varchar("actorId", { length: 128 }),
    action: mysqlEnum("action", ["created", "downloaded", "denied", "expired"]).notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("export_audit_events_export_idx").on(table.exportId)]
);

export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    externalWorkspaceId: varchar("externalWorkspaceId", { length: 128 }),
    actorId: varchar("actorId", { length: 128 }),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entityType", { length: 128 }).notNull(),
    entityId: varchar("entityId", { length: 128 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("audit_events_workspace_created_idx").on(table.externalWorkspaceId, table.createdAt)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
