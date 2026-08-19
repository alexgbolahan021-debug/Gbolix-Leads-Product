# Gbolix Leads — Ecosystem Boundary and Geography Decision

## Confirmed product boundary

Gbolix Leads will be developed as a separate, scalable lead-intelligence engine within the Gbolix ecosystem. It will not own the full customer relationship or commercial account lifecycle. The engine will own the research pipeline: discovery, source ingestion, enrichment, verification, normalization, deduplication, scoring, search execution, and lead-generation outputs.

Gbolix.site will remain the ecosystem system of record for the customer-facing and commercial concerns. It will own customer identity, authentication, workspaces or accounts, credits, billing, service requests, final delivery, and the customer-facing relationship. Leads will consume authorized identity and entitlement context from Gbolix.site and return pipeline status, generated lead results, usage events, and delivery-ready outputs.

## Ownership matrix

| Capability | System of record | Gbolix Leads responsibility |
|---|---|---|
| Customer identity | Gbolix.site | Validate delegated identity context; do not create a competing customer account system |
| Authentication and sessions | Gbolix.site | Accept signed service/user context and enforce engine-level authorization |
| Workspaces and memberships | Gbolix.site | Scope all data access to an external workspace/customer identifier |
| Credits and billing | Gbolix.site | Request authorization/reservation and emit usage or release events; do not maintain an independent balance |
| Service requests | Gbolix.site | Receive an authorized search request and return job status/results references |
| Lead discovery | Gbolix Leads | Own source adapters, discovery jobs, query execution, and candidate collection |
| Enrichment | Gbolix Leads | Own website analysis, structured extraction, technology and digital-presence signals |
| Verification | Gbolix Leads | Own deterministic checks, field states, confidence, conflicts, and timestamps |
| Deduplication | Gbolix Leads | Own canonical lead identity, match decisions, merges, and duplicate suppression |
| Scoring | Gbolix Leads | Own versioned scoring rules, components, reason codes, and score snapshots |
| Lead search and results | Gbolix Leads | Own search interpretation, filters, ranking, pagination, and evidence display APIs |
| Lists and lead organization | Decision required | Prefer Leads ownership with external workspace ID, unless Gbolix.site already owns a general list system |
| Export generation | Gbolix Leads | Generate authorized files and return delivery-ready artifacts or references |
| Final delivery | Gbolix.site | Own customer-facing delivery, notifications, request completion, and support workflow |
| Audit and commercial history | Gbolix.site | Own customer/billing audit trail; Leads keeps technical pipeline audit and provenance |

## Integration principle

The boundary should be implemented through explicit contracts rather than shared database tables. Gbolix Leads should have its own database and deployment lifecycle, while referencing external identifiers from Gbolix.site. This allows the engine to scale independently and prevents the lead pipeline from coupling directly to the customer platform’s internal schema.

The initial integration should use an authenticated server-to-server API or signed service events. The request should carry an external customer/workspace identifier, request identifier, actor identifier where applicable, authorized operation, requested result limit, and a credit authorization reference. Leads should return an idempotent job identifier and publish status transitions and usage events back to Gbolix.site.

## Cross-product contract principles

1. **No duplicated commercial truth.** Gbolix Leads never decides a customer’s balance, plan, invoice, refund, or billing status.
2. **No trust in client-supplied entitlements.** Credit authorization and workspace access must be verifiable from Gbolix.site-issued server-side context.
3. **Idempotency everywhere.** The external request ID, credit authorization ID, pipeline job ID, and usage event ID must be safely retryable.
4. **Asynchronous by default.** A lead-generation request should create a durable job and return progress rather than hold an HTTP request open for the entire pipeline.
5. **Evidence stays with the intelligence engine.** Gbolix Leads must preserve field-level provenance and verification evidence so Gbolix.site can present trustworthy final delivery.
6. **Versioned outputs.** Search criteria, scoring rules, source adapters, and lead snapshots need version identifiers so a delivered result can be reproduced or explained later.
7. **Least-privilege access.** The integration should expose only the minimum customer and entitlement fields needed for a lead job.

## Geography decision

The United States is a launch candidate, not a permanent geography commitment. The system should therefore model geography as a configurable search and source-coverage dimension rather than a hard-coded product assumption.

Before committing to US-first, the team should run a source validation exercise that compares candidate sources on geographic coverage, category coverage, freshness, contact-field availability, lawful retention/export rights, rate limits, cost per usable lead, duplicate rate, and verification quality. The result should be a source-coverage report with a go/no-go recommendation for the United States and at least one fallback market or source strategy.

## Required next architecture decisions

The revised architecture package must define the service contract between Gbolix.site and Gbolix Leads, the ownership of lists and exports, the authentication method for service calls, the credit reservation/release event model, the webhook or event delivery strategy, and the source-validation test plan. The database schema must use external customer and workspace IDs rather than assuming a shared Gbolix database.
