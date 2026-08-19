# Gbolix Leads — Cross-Product Contracts v0.1

## Purpose

This document defines the first integration boundary between Gbolix.site and Gbolix Leads. It is intentionally independent of any particular framework or database implementation. The contract uses external identifiers, asynchronous jobs, and immutable event IDs so either product can evolve without sharing internal tables.

## Request lifecycle

| Step | Actor | Action | Required identifier |
|---|---|---|---|
| 1 | Gbolix.site | Authorizes a lead-generation operation and reserves or approves the expected credit amount. | `credit_authorization_id` |
| 2 | Gbolix.site | Submits a lead-generation request to Leads. | `external_request_id` |
| 3 | Gbolix Leads | Validates signed service context, checks idempotency, creates a durable pipeline job, and returns `lead_job_id`. | `lead_job_id` |
| 4 | Gbolix Leads | Executes discovery, normalization, deduplication, enrichment, verification, scoring, and result assembly. | `pipeline_run_id` |
| 5 | Gbolix Leads | Emits progress and usage events. | `event_id` |
| 6 | Gbolix.site | Updates the customer request and credit ledger from verified events. | `external_request_id` and `event_id` |
| 7 | Gbolix Leads | Exposes result and evidence APIs or a delivery artifact reference. | `result_set_id` or `export_id` |
| 8 | Gbolix.site | Owns final customer delivery and request completion. | `external_request_id` |

## Inbound request: create lead job

Suggested endpoint: `POST /v1/lead-jobs`

```json
{
  "external_request_id": "gbolix-request-123",
  "external_customer_id": "gbolix-customer-456",
  "external_workspace_id": "gbolix-workspace-789",
  "actor_id": "gbolix-user-101",
  "operation": "discover_and_enrich",
  "search_spec": {
    "natural_language_query": "Find established restaurants in a target market with websites but no online booking",
    "country": "US",
    "regions": [],
    "cities": [],
    "industry": "restaurants",
    "required_signals": ["has_website"],
    "excluded_signals": ["has_online_booking"],
    "minimum_score": 0,
    "requested_leads": 100,
    "verified_email_only": false,
    "freshness_days": 90
  },
  "source_policy": {
    "allowed_source_ids": [],
    "allow_user_sources": true,
    "geography_is_candidate": true
  },
  "credit_authorization_id": "credit-auth-222",
  "idempotency_key": "gbolix-request-123-v1",
  "callback": {
    "mode": "polling_or_signed_event",
    "correlation_id": "gbolix-request-123"
  }
}
```

The service should return `202 Accepted` for a new job, `200 OK` for an idempotent replay of the same request, `400` for invalid search specifications, `401/403` for invalid service context, `409` for conflicting reuse of an idempotency key, and `422` when the request cannot be executed under the approved source or geography policy.

## Job response

```json
{
  "lead_job_id": "lead-job-333",
  "external_request_id": "gbolix-request-123",
  "status": "queued",
  "estimated_result_count": 100,
  "estimated_credit_usage": 100,
  "credit_authorization_id": "credit-auth-222",
  "created_at": "2026-08-19T12:00:00Z",
  "contract_version": "2026-08-19"
}
```

## Job status

Suggested endpoint: `GET /v1/lead-jobs/{lead_job_id}`

The job status should include `queued`, `running`, `partially_complete`, `completed`, `failed`, `cancel_requested`, `cancelled`, and `expired`. Progress must be stage-aware and must not imply that all requested leads will be found.

```json
{
  "lead_job_id": "lead-job-333",
  "external_request_id": "gbolix-request-123",
  "status": "partially_complete",
  "stage": "verification",
  "progress": {
    "candidates_discovered": 140,
    "canonical_leads": 112,
    "duplicates_suppressed": 28,
    "qualified_leads": 76,
    "requested_leads": 100
  },
  "result_set_id": "result-set-444",
  "usage": {
    "chargeable_new_leads": 76,
    "duplicate_leads": 28,
    "failed_or_unqualified": 36
  },
  "updated_at": "2026-08-19T12:04:00Z"
}
```

## Usage event contract

Usage events are append-only and must be safe to deliver more than once. Gbolix.site remains the balance owner. Leads reports what happened; it does not debit an independent balance.

```json
{
  "event_id": "usage-event-555",
  "event_type": "lead_usage_finalized",
  "external_request_id": "gbolix-request-123",
  "external_workspace_id": "gbolix-workspace-789",
  "lead_job_id": "lead-job-333",
  "credit_authorization_id": "credit-auth-222",
  "usage": {
    "new_qualified_leads": 76,
    "existing_duplicates": 28,
    "failed_or_unqualified": 36,
    "chargeable_credits": 76
  },
  "result_set_id": "result-set-444",
  "occurred_at": "2026-08-19T12:04:00Z",
  "contract_version": "2026-08-19"
}
```

Recommended event types are `lead_job_created`, `lead_job_progressed`, `lead_usage_reserved`, `lead_usage_finalized`, `lead_usage_released`, `lead_job_completed`, `lead_job_failed`, and `lead_export_ready`.

## Result and evidence contract

A result API should return canonical lead fields together with field-level evidence references. It should not return only a flattened spreadsheet row.

```json
{
  "result_set_id": "result-set-444",
  "lead": {
    "lead_id": "lead-666",
    "business_name": "Example Business",
    "website": "https://example.com",
    "email": {
      "value": "hello@example.com",
      "state": "partially_verified",
      "confidence": 0.96,
      "evidence_ids": ["evidence-1", "evidence-2"],
      "last_checked_at": "2026-08-19T12:03:00Z"
    },
    "score": {
      "value": 84,
      "version": "score-v1",
      "reasons": ["active_business_signal", "no_booking_detected"]
    },
    "provenance_summary": {
      "source_count": 3,
      "conflict_count": 0,
      "last_observed_at": "2026-08-19T12:03:00Z"
    }
  }
}
```

## Security and reliability requirements

The service boundary should use signed server-to-server authentication, request timestamps, nonce or replay protection, idempotency keys, rate limits, structured error codes, and correlation IDs. Leads should never accept a customer’s credit balance or role as an unsigned client field.

All external request IDs and event IDs should be unique within their owning system. A replayed request must return the original job rather than create another pipeline run. A replayed usage event must not cause a second credit debit in Gbolix.site.

## Open integration decisions

The following still require confirmation from the Gbolix platform implementation: whether Gbolix.site exposes an API gateway, whether it already has workspace and role identifiers, whether it supports signed webhooks or only polling, where credit reservations are created, who owns lead lists, and whether final exports are stored in Gbolix.site object storage or returned from Leads as signed artifacts.
