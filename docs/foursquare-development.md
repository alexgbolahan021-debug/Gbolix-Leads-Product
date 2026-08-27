# Foursquare Places development adapter

Gbolix Leads now treats business discovery as a provider-owned data operation. The AI gateway remains available for website evidence inference, classification, enrichment, and opportunity scoring; it does not invent or discover the business records.

The provider-neutral flow is:

```text
Foursquare Places or another approved provider
  → provider response mapping
  → lead schema validation and normalization
  → workspace-scoped deduplication
  → website enrichment when explicitly run
  → verification checks
  → deterministic and AI enrichment/scoring
  → customer results and export
```

## Current adapter

The adapter key is `foursquare-places-v1`. It uses the current official Place Search endpoint:

```text
GET https://places-api.foursquare.com/places/search
Authorization: Bearer <server-side service key>
X-Places-Api-Version: 2025-06-17
```

The implementation uses a city coordinate, bounded radius, the category query, an explicit low-cost field list, a maximum of 50 results per page, and at most three pages. It follows only the pagination link returned by Foursquare and caps the total request at 100 records.

The source is candidate/disabled in production until an owner adds an official service key, accepts the provider’s terms and retention/attribution rules, sets a result cap and budget, and explicitly approves it in the owner portal. No production Foursquare credential is present in this repository or development test.

## Credential-free development test

From the Leads engine repository, run:

```bash
NODE_ENV=development FOURSQUARE_MOCK_MODE=true node --import tsx scripts/simulate-foursquare-development.mjs
```

The harness generates 100 Foursquare-shaped restaurant records for Austin, validates them with the existing lead schema, normalizes identity fields, runs workspace-style duplicate comparison, performs existing verification logic, and calculates the existing deterministic opportunity scores. Website retrieval is intentionally skipped in fixture mode so the test makes no public website requests. AI evidence inference remains preserved as a downstream stage and is not invoked with a production credential.

Expected development summary:

| Stage | Expected result |
|---|---:|
| Provider records returned | 100 |
| Schema-valid records | 100 |
| Duplicates suppressed | 0 for the unique fixture |
| Candidates after deduplication | 100 |
| Verification records calculated | 100 |
| Deterministic scores calculated | 100 |
| Production Foursquare credentials used | No |
| Production database or storage touched | No |

## Production activation later

Production activation should be a separate deliberate step. The owner must configure the Foursquare service key through the encrypted discovery-source control in `/admin/leads`, not the frontend and not a chat message. The provider should be kept at a small per-job cap initially, and its daily budget should be nonzero only after the account’s pricing and quota terms have been reviewed. The customer source selector will expose Foursquare only when the API-side source record is enabled and approved.

The adapter uses the official API only. It does not scrape Google Maps, Foursquare web pages, or the general Internet.

## Official references

1. [Foursquare Places API overview](https://docs.foursquare.com/fsq-developers-places/reference/places-api-overview)
2. [Foursquare Place Search](https://docs.foursquare.com/fsq-developers-places/reference/place-search)
3. [Foursquare Authentication](https://docs.foursquare.com/fsq-developers-places/reference/authentication)
4. [Foursquare Pagination](https://docs.foursquare.com/fsq-developers-places/reference/pagination)
5. [Foursquare Upcoming Changes and pricing](https://docs.foursquare.com/developer/reference/upcoming-changes)
