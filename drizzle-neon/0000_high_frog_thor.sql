CREATE TABLE "audit_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128),
	"actorId" varchar(128),
	"action" varchar(128) NOT NULL,
	"entityType" varchar(128) NOT NULL,
	"entityId" varchar(128),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"leadId" varchar(36) NOT NULL,
	"ingestionSourceId" varchar(36),
	"evidenceType" varchar(24) NOT NULL,
	"sourceUrl" varchar(2048),
	"sourceLabel" varchar(255) NOT NULL,
	"pageTitle" varchar(512),
	"excerpt" text,
	"contentHash" varchar(128),
	"retrievalStatus" varchar(24) DEFAULT 'captured' NOT NULL,
	"retrievedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"retentionClass" varchar(96) DEFAULT 'workspace-controlled' NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "export_audit_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"exportId" varchar(36) NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"actorId" varchar(128),
	"action" varchar(16) NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"leadJobId" varchar(36),
	"requestedBy" varchar(128),
	"format" varchar(16) DEFAULT 'csv' NOT NULL,
	"status" varchar(16) DEFAULT 'generating' NOT NULL,
	"selectedLeadIds" jsonb NOT NULL,
	"leadCount" integer DEFAULT 0 NOT NULL,
	"objectKey" varchar(512),
	"storageUrl" varchar(2048),
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_workspaces" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"externalCustomerId" varchar(128),
	"displayName" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_matches" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"incomingLeadId" varchar(36) NOT NULL,
	"matchedLeadId" varchar(36) NOT NULL,
	"matchState" varchar(16) NOT NULL,
	"score" double precision NOT NULL,
	"signals" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_sources" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"sourceDefinitionId" varchar(36) NOT NULL,
	"label" varchar(255) NOT NULL,
	"inputType" varchar(32) NOT NULL,
	"originalFileName" varchar(255),
	"originalObjectKey" varchar(512),
	"fieldMapping" jsonb,
	"totalRows" integer DEFAULT 0 NOT NULL,
	"validRows" integer DEFAULT 0 NOT NULL,
	"invalidRows" integer DEFAULT 0 NOT NULL,
	"createdBy" varchar(128),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"externalRequestId" varchar(128) NOT NULL,
	"leadJobId" varchar(36),
	"creditAuthorizationId" varchar(128),
	"eventType" varchar(32) NOT NULL,
	"idempotencyKey" varchar(192) NOT NULL,
	"deliveryState" varchar(16) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_category_definitions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"code" varchar(96) NOT NULL,
	"label" varchar(255) NOT NULL,
	"parentCode" varchar(96),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"scoringProfile" varchar(96) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_field_observations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"leadId" varchar(36) NOT NULL,
	"evidenceId" varchar(36),
	"fieldKey" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"normalizedValue" text,
	"origin" varchar(24) NOT NULL,
	"verificationState" varchar(24) DEFAULT 'unverified' NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"isCanonical" boolean DEFAULT false NOT NULL,
	"observedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"supersededAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_jobs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"externalRequestId" varchar(128) NOT NULL,
	"creditAuthorizationId" varchar(128),
	"ingestionSourceId" varchar(36),
	"operation" varchar(24) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"categoryCode" varchar(96),
	"requestPayload" jsonb,
	"requestedCount" integer DEFAULT 0 NOT NULL,
	"processedCount" integer DEFAULT 0 NOT NULL,
	"duplicateCount" integer DEFAULT 0 NOT NULL,
	"qualifiedCount" integer DEFAULT 0 NOT NULL,
	"chargeableCredits" integer DEFAULT 0 NOT NULL,
	"errorMessage" text,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_merge_events" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"sourceLeadId" varchar(36) NOT NULL,
	"targetLeadId" varchar(36) NOT NULL,
	"reason" varchar(512) NOT NULL,
	"matchScore" double precision NOT NULL,
	"mergeSnapshot" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_score_components" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"leadScoreId" varchar(36) NOT NULL,
	"componentKey" varchar(128) NOT NULL,
	"points" integer NOT NULL,
	"reasonCode" varchar(128) NOT NULL,
	"explanation" varchar(512) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scores" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"leadId" varchar(36) NOT NULL,
	"scoreVersionId" varchar(36) NOT NULL,
	"totalScore" integer NOT NULL,
	"calculatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"externalWorkspaceId" varchar(128) NOT NULL,
	"businessName" varchar(320) NOT NULL,
	"legalName" varchar(320),
	"industry" varchar(255),
	"categoryCode" varchar(96),
	"description" text,
	"website" varchar(2048),
	"canonicalDomain" varchar(255),
	"publicEmail" varchar(320),
	"canonicalEmail" varchar(320),
	"phone" varchar(64),
	"canonicalPhone" varchar(32),
	"country" varchar(2),
	"region" varchar(128),
	"city" varchar(128),
	"address" text,
	"postalCode" varchar(32),
	"canonicalName" varchar(320) NOT NULL,
	"canonicalLocation" varchar(512),
	"lifecycleStatus" varchar(16) DEFAULT 'active' NOT NULL,
	"dataConfidence" double precision DEFAULT 0 NOT NULL,
	"lastVerifiedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_versions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"version" varchar(96) NOT NULL,
	"categoryCode" varchar(96) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"definition" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_definitions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"adapterKey" varchar(96) NOT NULL,
	"name" varchar(255) NOT NULL,
	"sourceKind" varchar(32) NOT NULL,
	"approvalStatus" varchar(16) DEFAULT 'candidate' NOT NULL,
	"geographyStatus" varchar(16) DEFAULT 'candidate' NOT NULL,
	"capabilities" jsonb,
	"retentionPolicy" varchar(255) DEFAULT 'workspace-controlled' NOT NULL,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "verification_checks" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"leadId" varchar(36) NOT NULL,
	"fieldKey" varchar(128) NOT NULL,
	"checkType" varchar(32) NOT NULL,
	"checkState" varchar(16) NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"details" jsonb,
	"checkedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" USING btree ("externalWorkspaceId","createdAt");--> statement-breakpoint
CREATE INDEX "evidence_records_lead_idx" ON "evidence_records" USING btree ("leadId");--> statement-breakpoint
CREATE INDEX "export_audit_events_export_idx" ON "export_audit_events" USING btree ("exportId");--> statement-breakpoint
CREATE INDEX "exports_workspace_status_idx" ON "exports" USING btree ("externalWorkspaceId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_workspaces_external_id_unique" ON "external_workspaces" USING btree ("externalWorkspaceId");--> statement-breakpoint
CREATE INDEX "identity_matches_incoming_idx" ON "identity_matches" USING btree ("incomingLeadId");--> statement-breakpoint
CREATE INDEX "ingestion_sources_workspace_idx" ON "ingestion_sources" USING btree ("externalWorkspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_idempotency_unique" ON "integration_events" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_category_definitions_code_unique" ON "lead_category_definitions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "lead_observations_lead_field_idx" ON "lead_field_observations" USING btree ("leadId","fieldKey");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_jobs_external_request_unique" ON "lead_jobs" USING btree ("externalRequestId");--> statement-breakpoint
CREATE INDEX "lead_jobs_workspace_status_idx" ON "lead_jobs" USING btree ("externalWorkspaceId","status");--> statement-breakpoint
CREATE INDEX "lead_merge_events_target_idx" ON "lead_merge_events" USING btree ("targetLeadId");--> statement-breakpoint
CREATE INDEX "lead_score_components_score_idx" ON "lead_score_components" USING btree ("leadScoreId");--> statement-breakpoint
CREATE INDEX "lead_scores_lead_idx" ON "lead_scores" USING btree ("leadId");--> statement-breakpoint
CREATE INDEX "leads_workspace_domain_idx" ON "leads" USING btree ("externalWorkspaceId","canonicalDomain");--> statement-breakpoint
CREATE INDEX "leads_workspace_phone_idx" ON "leads" USING btree ("externalWorkspaceId","canonicalPhone");--> statement-breakpoint
CREATE INDEX "leads_workspace_name_location_idx" ON "leads" USING btree ("externalWorkspaceId","canonicalName","canonicalLocation");--> statement-breakpoint
CREATE UNIQUE INDEX "score_versions_version_category_unique" ON "score_versions" USING btree ("version","categoryCode");--> statement-breakpoint
CREATE UNIQUE INDEX "source_definitions_adapter_key_unique" ON "source_definitions" USING btree ("adapterKey");--> statement-breakpoint
CREATE INDEX "verification_checks_lead_field_idx" ON "verification_checks" USING btree ("leadId","fieldKey");