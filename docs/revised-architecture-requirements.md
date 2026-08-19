# Gbolix Leads — Revised Architecture and Schema Requirements

## Architecture decision

Gbolix Leads should be implemented as a separately deployable lead-intelligence engine with its own database, queue or worker execution, source adapters, enrichment pipeline, evidence store, and result APIs. It remains a Gbolix ecosystem product through a formal integration contract with Gbolix.site rather than through shared database tables.

Gbolix.site remains the commercial and customer system of record. Gbolix Leads receives external customer, workspace, request, actor, and credit-authorization identifiers; it does not create competing accounts, balances, invoices, or sessions. The Leads engine owns the technical intelligence lifecycle from candidate discovery through delivery-ready lead results.

## High-level topology

```text
Gbolix.site
  Customer identity • authentication • workspaces • requests • credits • billing • delivery
       │
       │ signed server-to-server API/events
       ▼
Gbolix Leads API
  Request validation • idempotency • authorization context • job creation
       │
       ▼
Lead job orchestrator and durable queue
       │
       ├── Discovery source adapters
       ├── User-source ingestion
       ├── Normalization and identity resolution
       ├── Evidence-aware enrichment
       ├── Deterministic verification
       ├── Versioned scoring
       └── Result and export assembly
       │
       ▼
Gbolix Leads database and evidence/object storage
       │
       └── Status, usage, result, and delivery events back to Gbolix.site
```

The geography layer must be configuration-driven. A market is enabled only when one or more approved sources pass the coverage and quality benchmark. The United States should initially be represented as `candidate`, not `enabled`, until the benchmark is complete.

## Required service boundaries

| Service boundary | Owns | Must not own |
|---|---|---|
| Gbolix integration API | External request intake, authentication context, idempotency, job/result contracts | Customer balances, invoices, internal Gbolix session state |
| Discovery adapters | Provider-specific query translation, pagination, rate limits, raw candidate mapping | Canonical lead truth or unreviewed durable exports |
| Evidence and extraction | Retrieval metadata, allowed evidence, structured observations, extraction method | Unsubstantiated facts or silent canonical overwrites |
| Identity resolution | Normalization, match candidates, merge decisions, duplicate suppression | Commercial credit debit |
| Verification | Field checks, confidence, states, conflicts, timestamps | Guaranteeing human ownership of an inbox or phone |
| Scoring | Versioned score components, reason codes, score snapshots | Hidden or irreproducible ranking logic |
| Integration events | Usage, progress, completion, release, and failure events | Independent credit balance |

## Schema requirements

All core tables should include an internal primary key, external workspace/customer scope where applicable, created and updated timestamps, and a soft-deletion or retention strategy appropriate to the source policy. The database should preserve external IDs without assuming they are globally meaningful outside the Gbolix ecosystem.

| Table group | Required tables | Key requirements |
|---|---|---|
| Integration scope | `external_accounts`, `external_workspaces`, `integration_requests`, `integration_events` | Store external IDs, contract version, correlation IDs, idempotency keys, signature metadata, and processing status. |
| Lead identity | `leads`, `lead_domains`, `lead_external_ids`, `lead_merge_events` | Canonical identity, normalized domain/phone/name keys, merge history, split support, and source-specific identifiers. |
| Field truth | `lead_field_observations`, `lead_field_values` or typed field tables | Separate current canonical values from observations; preserve state, confidence, observed time, supersession, and evidence references. |
| Evidence | `evidence_records`, `evidence_artifacts`, `source_retrievals` | Source, URL or locator, retrieval time, content hash, retention class, policy ID, excerpt/selector, and extraction method. |
| Sources | `sources`, `source_policies`, `source_capabilities`, `source_coverage` | Approval state, geography/category coverage, legal retention/export class, rate limits, cost metadata, and benchmark results. |
| Pipeline | `lead_jobs`, `pipeline_runs`, `pipeline_steps`, `pipeline_attempts`, `pipeline_errors` | Durable states, retry counts, idempotency, cancellation, provider request IDs, latency, and failure reason. |
| Search | `search_specs`, `search_filters`, `search_results`, `search_result_leads` | Versioned interpreted criteria, source policy, requested limit, ranking version, result snapshot, and estimated versus actual usage. |
| Quality | `score_versions`, `lead_scores`, `score_components`, `verification_checks`, `verification_conflicts` | Reproducible scores, component explanations, check method, confidence, and conflict resolution. |
| Organization | `lead_lists`, `lead_list_memberships`, `lead_tags`, `lead_notes` | External workspace ownership, many-to-many lists, authorization, and audit history. |
| Artifacts | `exports`, `export_items`, `artifact_access_events` | Selected lead snapshot, format, expiry, authorization, signed URL metadata, and download audit. |

## Canonical lead identity requirements

The system must not use a single field such as business name as a unique key. Identity resolution should calculate a match decision from normalized domain, source identifiers, phone, public email, business name, and location. Each candidate match should record the matching signals and confidence. Automatic merges require a high-confidence rule; ambiguous candidates should remain separate until reviewed or resolved by a conservative policy.

## Geography and source enablement model

A source coverage record should be maintained for each source, country, region, city class, and category family. It should include benchmark sample size, candidate count, unique count, valid website rate, contactability rate, duplicate rate, freshness rate, verification completion, cost per qualified lead, and test date.

A geography can be marked `candidate`, `benchmarking`, `approved`, `degraded`, or `disabled`. Search execution must refuse a market that is not approved unless the request explicitly uses user-provided sources. This prevents marketing language or a default UI setting from promising coverage that has not been proven.

## Credit integration requirements

Leads should create usage estimates and final usage facts. Gbolix.site should reserve, finalize, release, and reconcile credits. A final event must distinguish new qualified leads, pre-existing duplicates, unqualified/failed records, and any provider or processing failures. Every event must be idempotent and carry the original credit-authorization reference.

## First implementation slice

The first code slice should implement the integration contract, schema migrations, source-policy registry, user-provided CSV/domain ingestion, canonical identity and deduplication, deterministic website enrichment, evidence records, versioned score output, asynchronous job status, and CSV result export. A discovery-provider adapter can be plugged in after the source approval and benchmark are complete.

## Non-goals for the first slice

The first slice should not permanently commit the product to the United States, Google Places, a specific CRM, AI-generated outreach, mailbox ownership guarantees, global coverage, or a shared Gbolix database. Those should remain configurable or deferred until source and product validation support them.
