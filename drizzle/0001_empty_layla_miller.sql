CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128),
	`actorId` varchar(128),
	`action` varchar(128) NOT NULL,
	`entityType` varchar(128) NOT NULL,
	`entityId` varchar(128),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence_records` (
	`id` varchar(36) NOT NULL,
	`leadId` varchar(36) NOT NULL,
	`ingestionSourceId` varchar(36),
	`evidenceType` enum('user_row','website_page','provider_record','verification') NOT NULL,
	`sourceUrl` varchar(2048),
	`sourceLabel` varchar(255) NOT NULL,
	`pageTitle` varchar(512),
	`excerpt` text,
	`contentHash` varchar(128),
	`retrievalStatus` enum('captured','blocked','failed','not_applicable') NOT NULL DEFAULT 'captured',
	`retrievedAt` timestamp NOT NULL DEFAULT (now()),
	`retentionClass` varchar(96) NOT NULL DEFAULT 'workspace-controlled',
	`metadata` json,
	CONSTRAINT `evidence_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `export_audit_events` (
	`id` varchar(36) NOT NULL,
	`exportId` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`actorId` varchar(128),
	`action` enum('created','downloaded','denied','expired') NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `export_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `exports` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`leadJobId` varchar(36),
	`requestedBy` varchar(128),
	`format` enum('csv') NOT NULL DEFAULT 'csv',
	`status` enum('generating','ready','expired','failed') NOT NULL DEFAULT 'generating',
	`selectedLeadIds` json NOT NULL,
	`leadCount` int NOT NULL DEFAULT 0,
	`objectKey` varchar(512),
	`storageUrl` varchar(2048),
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `exports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `external_workspaces` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`externalCustomerId` varchar(128),
	`displayName` varchar(255) NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `external_workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `external_workspaces_external_id_unique` UNIQUE(`externalWorkspaceId`)
);
--> statement-breakpoint
CREATE TABLE `identity_matches` (
	`id` varchar(36) NOT NULL,
	`incomingLeadId` varchar(36) NOT NULL,
	`matchedLeadId` varchar(36) NOT NULL,
	`matchState` enum('auto_merged','candidate','rejected') NOT NULL,
	`score` double NOT NULL,
	`signals` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `identity_matches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingestion_sources` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`sourceDefinitionId` varchar(36) NOT NULL,
	`label` varchar(255) NOT NULL,
	`inputType` enum('csv_upload','domain_list','provider_adapter') NOT NULL,
	`originalFileName` varchar(255),
	`originalObjectKey` varchar(512),
	`fieldMapping` json,
	`totalRows` int NOT NULL DEFAULT 0,
	`validRows` int NOT NULL DEFAULT 0,
	`invalidRows` int NOT NULL DEFAULT 0,
	`createdBy` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ingestion_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_events` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`externalRequestId` varchar(128) NOT NULL,
	`leadJobId` varchar(36),
	`creditAuthorizationId` varchar(128),
	`eventType` enum('lead_job_created','lead_job_progressed','lead_usage_finalized','lead_usage_released','lead_job_completed','lead_job_failed','lead_export_ready') NOT NULL,
	`idempotencyKey` varchar(192) NOT NULL,
	`deliveryState` enum('pending','delivered','failed') NOT NULL DEFAULT 'pending',
	`payload` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integration_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `integration_events_idempotency_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `lead_category_definitions` (
	`id` varchar(36) NOT NULL,
	`code` varchar(96) NOT NULL,
	`label` varchar(255) NOT NULL,
	`parentCode` varchar(96),
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`scoringProfile` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_category_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_category_definitions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `lead_field_observations` (
	`id` varchar(36) NOT NULL,
	`leadId` varchar(36) NOT NULL,
	`evidenceId` varchar(36),
	`fieldKey` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`normalizedValue` text,
	`origin` enum('user_provided','source_api','website','ai_inferred') NOT NULL,
	`verificationState` enum('verified','partially_verified','unverified','conflicting','unavailable') NOT NULL DEFAULT 'unverified',
	`confidence` double NOT NULL DEFAULT 0,
	`isCanonical` boolean NOT NULL DEFAULT false,
	`observedAt` timestamp NOT NULL DEFAULT (now()),
	`supersededAt` timestamp,
	CONSTRAINT `lead_field_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_jobs` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`externalRequestId` varchar(128) NOT NULL,
	`creditAuthorizationId` varchar(128),
	`ingestionSourceId` varchar(36),
	`operation` enum('ingest','enrich','verify','score','ai_infer','export') NOT NULL,
	`status` enum('queued','running','partially_complete','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`categoryCode` varchar(96),
	`requestPayload` json,
	`requestedCount` int NOT NULL DEFAULT 0,
	`processedCount` int NOT NULL DEFAULT 0,
	`duplicateCount` int NOT NULL DEFAULT 0,
	`qualifiedCount` int NOT NULL DEFAULT 0,
	`chargeableCredits` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `lead_jobs_external_request_unique` UNIQUE(`externalRequestId`)
);
--> statement-breakpoint
CREATE TABLE `lead_merge_events` (
	`id` varchar(36) NOT NULL,
	`sourceLeadId` varchar(36) NOT NULL,
	`targetLeadId` varchar(36) NOT NULL,
	`reason` varchar(512) NOT NULL,
	`matchScore` double NOT NULL,
	`mergeSnapshot` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_merge_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_score_components` (
	`id` varchar(36) NOT NULL,
	`leadScoreId` varchar(36) NOT NULL,
	`componentKey` varchar(128) NOT NULL,
	`points` int NOT NULL,
	`reasonCode` varchar(128) NOT NULL,
	`explanation` varchar(512) NOT NULL,
	CONSTRAINT `lead_score_components_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_scores` (
	`id` varchar(36) NOT NULL,
	`leadId` varchar(36) NOT NULL,
	`scoreVersionId` varchar(36) NOT NULL,
	`totalScore` int NOT NULL,
	`calculatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` varchar(36) NOT NULL,
	`externalWorkspaceId` varchar(128) NOT NULL,
	`businessName` varchar(320) NOT NULL,
	`legalName` varchar(320),
	`industry` varchar(255),
	`categoryCode` varchar(96),
	`description` text,
	`website` varchar(2048),
	`canonicalDomain` varchar(255),
	`publicEmail` varchar(320),
	`canonicalEmail` varchar(320),
	`phone` varchar(64),
	`canonicalPhone` varchar(32),
	`country` varchar(2),
	`region` varchar(128),
	`city` varchar(128),
	`address` text,
	`postalCode` varchar(32),
	`canonicalName` varchar(320) NOT NULL,
	`canonicalLocation` varchar(512),
	`lifecycleStatus` enum('active','merged','suppressed','archived') NOT NULL DEFAULT 'active',
	`dataConfidence` double NOT NULL DEFAULT 0,
	`lastVerifiedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `score_versions` (
	`id` varchar(36) NOT NULL,
	`version` varchar(96) NOT NULL,
	`categoryCode` varchar(96) NOT NULL,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`definition` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `score_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `score_versions_version_category_unique` UNIQUE(`version`,`categoryCode`)
);
--> statement-breakpoint
CREATE TABLE `source_definitions` (
	`id` varchar(36) NOT NULL,
	`adapterKey` varchar(96) NOT NULL,
	`name` varchar(255) NOT NULL,
	`sourceKind` enum('user_provided','provider_adapter','website') NOT NULL,
	`approvalStatus` enum('approved','candidate','disabled') NOT NULL DEFAULT 'candidate',
	`geographyStatus` enum('candidate','benchmarking','approved','degraded','disabled') NOT NULL DEFAULT 'candidate',
	`capabilities` json,
	`retentionPolicy` varchar(255) NOT NULL DEFAULT 'workspace-controlled',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `source_definitions_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_definitions_adapter_key_unique` UNIQUE(`adapterKey`)
);
--> statement-breakpoint
CREATE TABLE `verification_checks` (
	`id` varchar(36) NOT NULL,
	`leadId` varchar(36) NOT NULL,
	`fieldKey` varchar(128) NOT NULL,
	`checkType` enum('syntax','domain','website_relationship','cross_source') NOT NULL,
	`checkState` enum('passed','failed','not_run','conflicting') NOT NULL,
	`confidence` double NOT NULL DEFAULT 0,
	`details` json,
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verification_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_events_workspace_created_idx` ON `audit_events` (`externalWorkspaceId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `evidence_records_lead_idx` ON `evidence_records` (`leadId`);--> statement-breakpoint
CREATE INDEX `export_audit_events_export_idx` ON `export_audit_events` (`exportId`);--> statement-breakpoint
CREATE INDEX `exports_workspace_status_idx` ON `exports` (`externalWorkspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `identity_matches_incoming_idx` ON `identity_matches` (`incomingLeadId`);--> statement-breakpoint
CREATE INDEX `ingestion_sources_workspace_idx` ON `ingestion_sources` (`externalWorkspaceId`);--> statement-breakpoint
CREATE INDEX `lead_observations_lead_field_idx` ON `lead_field_observations` (`leadId`,`fieldKey`);--> statement-breakpoint
CREATE INDEX `lead_jobs_workspace_status_idx` ON `lead_jobs` (`externalWorkspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `lead_merge_events_target_idx` ON `lead_merge_events` (`targetLeadId`);--> statement-breakpoint
CREATE INDEX `lead_score_components_score_idx` ON `lead_score_components` (`leadScoreId`);--> statement-breakpoint
CREATE INDEX `lead_scores_lead_idx` ON `lead_scores` (`leadId`);--> statement-breakpoint
CREATE INDEX `leads_workspace_domain_idx` ON `leads` (`externalWorkspaceId`,`canonicalDomain`);--> statement-breakpoint
CREATE INDEX `leads_workspace_phone_idx` ON `leads` (`externalWorkspaceId`,`canonicalPhone`);--> statement-breakpoint
CREATE INDEX `leads_workspace_name_location_idx` ON `leads` (`externalWorkspaceId`,`canonicalName`,`canonicalLocation`);--> statement-breakpoint
CREATE INDEX `verification_checks_lead_field_idx` ON `verification_checks` (`leadId`,`fieldKey`);