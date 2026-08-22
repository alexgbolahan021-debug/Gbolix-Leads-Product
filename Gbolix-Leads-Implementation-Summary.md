# Gbolix Leads: Build Summary

## Product outcome

Gbolix Leads has been built as a **separate lead-intelligence engine inside the Gbolix ecosystem**, rather than as a separate customer-facing SaaS. Gbolix.site remains the control plane for customer accounts, workspace membership, entitlements, Wallet credits, Paystack billing, lead requests, and customer-facing results. The Leads engine is responsible for source intake, discovery, normalization, provenance, duplicate suppression, verification, scoring, and private exports.

The customer experience has evolved from a technical lead-request form into a **simple AI chat workflow**. A customer can state their need naturally; the system prepares a bounded proposal; the customer must explicitly approve it before any credit reservation or lead discovery can begin.

| Area | Delivered capability |
|---|---|
| Customer identity and billing | Controlled by Gbolix workspaces and Wallet, not the Leads engine. |
| Lead intelligence | Separate engine for intake, discovery, normalization, evidence, verification, scoring, deduplication, and exports. |
| Customer experience | AI chat first; CSV and domain import retained as an advanced option. |
| First discovery source | Small, attributed, user-triggered OpenStreetMap pilot; not Google Maps scraping. |
| Credit safety | Reserve maximum potential credits, then finalize only qualified new leads and release unused reservations. |

## Core engine completed

The Leads engine now has an isolated PostgreSQL/Neon data model for workspaces, source definitions, jobs, raw source records, normalized leads, observations, evidence, verification checks, versioned scores, exports, and technical audit events. It accepts user-provided CSV files and domain lists, normalizes business names, domains, phones, emails, and locations, and uses conservative identity matching to suppress duplicates before charging.

Every lead can retain provenance: the source, source URL, retrieval time, evidence, verification state, conflicts, and score reasons. AI-derived observations are stored separately from verified/source-backed facts so that AI output never silently overwrites a verified lead field. Customer exports are private, workspace-scoped, time-limited, and include the latest total score, score version, and score reasons.

## Gbolix control-plane integration

The Gbolix API and Leads engine communicate through signed server-to-server requests. Gbolix signs intake requests using HMAC headers; the engine verifies them before accepting work. The engine signs callbacks back to Gbolix for job state, result availability, final credit use, duplicate suppression, and releases.

| Lifecycle stage | Responsible system | Implemented behavior |
|---|---|---|
| Request authorization | Gbolix API | Checks workspace entitlement and Wallet before dispatch. |
| Credit reserve | Gbolix API / Wallet | Reserves the maximum bounded candidate count. |
| Discovery and deduplication | Leads engine | Processes candidates and suppresses workspace duplicates. |
| Usage finalization | Signed engine callback to Gbolix | Finalizes only actual qualified new leads and releases the remainder. |
| Results and export | Gbolix customer workspace | Shows workspace-scoped leads and requests private score-inclusive CSV downloads. |

Several lifecycle defects were found and corrected during implementation. A synchronous engine callback could formerly mark a completed job as `running`; the lifecycle guard and reconciliation repair fixed this. A storage configuration failure was traced to missing S3-compatible settings, and the engine is now configured to use an isolated private Supabase Storage bucket. A customer Wallet settlement issue was corrected to validate Paystack’s `requested_amount` where available, preventing fee-inflated amounts from blocking valid credit settlement.

## Wallet and Paystack work

Gbolix Wallet v1.0 is implemented around workspace-owned, non-expiring credits. The approved packs are Starter (100 credits for $15), Growth (250 for $29), Professional (500 for $49), and Scale (1,000 for $89). A qualified, new lead consumes one credit. Existing workspace duplicates are suppressed before credit use.

Because the merchant checkout flow uses NGN, the Gbolix API now uses a database-backed USD-to-NGN rate cache with a two-hour freshness window. The Wallet checkout return was also corrected: Paystack’s browser `callback_url` now points to the public frontend route `https://www.gbolix.site/payment/callback`, while the API webhook remains private and server-to-server. The user completed a Wallet test payment and confirmed that credits were added.

## Hosting and storage

| Component | Current design |
|---|---|
| Gbolix frontend | Vercel at `www.gbolix.site`. |
| Gbolix API | Render. |
| Leads engine | Render at `lead.gbolix.site`. |
| Gbolix Wallet database | Existing separate Gbolix Neon/PostgreSQL database. |
| Leads database | Separate Neon/PostgreSQL database. |
| Leads source/export storage | Isolated Supabase project `gbolix-leads-storage`, private bucket `gbolix-leads-private`. |

The private storage configuration keeps source inputs and exported results out of public web paths. Storage credentials are server-side only and are not exposed in frontend code or chat.

## Discovery approach

The project deliberately does **not** depend on blind Google Maps scraping. Instead, it uses a provider-neutral adapter boundary so commercial providers can be added later without redesigning the pipeline.

The initial OpenStreetMap pilot is intentionally narrow: it is user-triggered, requires one city, supports restaurants and real estate, caps discovery at 25 candidates, stores public source provenance, and displays OpenStreetMap attribution. Nominatim use is rate-limited and cached for city lookup. The query now recognizes both legitimate `office=estate_agent` and `shop=estate_agent` forms for real-estate agencies.

This pilot is suitable for controlled validation only. It is not intended as an unlimited, background, or bulk lead source. A commercial provider such as Foursquare remains the appropriate next step for scale and predictable coverage.

## Conversational AI lead-request workflow

The new customer path works as follows:

1. A customer writes a plain-language request, for example: “Find 5 restaurants in Lagos that may need a new website and automation.”
2. The Gbolix API planner uses Gemini structured JSON to extract only supported category, city, desired count, label, and customer-stated constraints.
3. The chat displays a bounded proposal showing the maximum possible credit reservation. It does not dispatch, reserve credits, or claim leads have been found.
4. Only an explicit customer confirmation creates the OpenStreetMap discovery request.
5. Gbolix signs the request; the Leads engine preserves the city, requested limit, and optional keywords in discovery metadata.
6. Results return to the Gbolix workspace with source attribution, scores, and private CSV access.

The planner is deliberately conservative. It accepts restaurants and real estate, requires a city, caps suggestions at 25, extracts no more than eight optional keywords, and asks for clarification instead of inventing a missing city, category, or quantity. If a customer says “I need some restaurant leads,” the system asks for city and quantity and creates no confirmable request.

## Local customer-flow verification

The complete local flow was tested without production Wallet credits, production database writes, or private storage access. The Gemini network call was mocked only because the production server-only key is not configured locally; the real production planner function, confirmation helper, signed constraints, and real OpenStreetMap adapter were exercised.

| Customer scenario | Observed result |
|---|---|
| “Find 5 restaurants in Lagos that may need a new website and automation.” | A proposal for five Lagos restaurants was generated with `website` and `automation` constraints. After simulated confirmation, the real OpenStreetMap pilot returned five businesses: Mr Biggs, Mama Cass, Cactus, Bogobiri House Hotel and Restaurant, and The Place. |
| “I need some restaurant leads.” | A clarification asking for city and quantity was generated. The request was not confirmable or dispatchable. |
| Additional real-estate source probe | The expanded query passed offline regression tests. Further public probing was stopped after the public endpoint returned a temporary 429 rate-limit response, rather than retrying against public infrastructure. |

The automated test status at the latest local validation was **27 passing Leads tests**, **25 passing Gbolix API tests**, and **3 passing frontend chat-helper tests**. Leads production build, API build, and frontend build have also passed during this work.

## Key delivery revisions

| Repository | Latest relevant revision | Purpose |
|---|---:|---|
| `alexgbolahan021-debug/Gbolix-Leads-Product` | `ee1cdcc` | AI constraint propagation, local customer-flow simulator, OpenStreetMap pilot improvements, and expanded real-estate agency query. |
| `alexgbolahan021-debug/Gbolix` | `36be700` | Conversational request workflow, server-side Gemini planner, confirmation UI, related tests, Wallet callback documentation, and coordinated release guide. |

## What is ready for deployment

The coordinated release guide is in `docs/gbolix-leads-conversational-release.md` in the Gbolix repository. The release must be coordinated; the Vercel frontend should not go live before its Gbolix API planner and Leads engine dependencies are available.

| Deployment order | Service | Required action |
|---:|---|---|
| 1 | Leads engine Render service | Deploy `ee1cdcc` or a later compatible revision and check `https://lead.gbolix.site/health`. |
| 2 | Gbolix API Render service | Add `GEMINI_API_KEY` only here, then deploy `36be700` or later. `GEMINI_MODEL` may remain unset to use `gemini-2.5-flash`. |
| 3 | Gbolix frontend Vercel project | Deploy `36be700` or later last. Do not add a Gemini key to Vercel. |

## Remaining production verification

The following items depend on the coordinated deployment or an authenticated production session, so they have not been falsely marked complete.

1. Configure the server-only Gemini key on the Gbolix API Render service and deploy all three components together.
2. Run a production clarification request and confirm that it reserves no credits and dispatches no job.
3. Run one explicitly confirmed, five-candidate discovery pilot and verify status, attribution, duplicate-safe finalization, results table, and private score-inclusive CSV download.
4. Record Wallet ledger evidence for failed-job release and reconciled-job single finalization.
5. Run one fresh-browser Wallet checkout trace to confirm the corrected Paystack browser return never includes the invalid Clerk proxy hostname.
6. Recheck real-estate candidate coverage in a controlled permitted window; OpenStreetMap coverage varies by city and the public endpoint must not be stressed.

## Bottom line

The requested Gbolix Leads foundation is built: a separate and secure intelligence engine, integrated Wallet and signed control plane, private results delivery, a compliant bounded discovery pilot, and a customer-friendly AI chat that only runs a job after explicit confirmation. The local flow already generated real restaurant leads. The remaining work is focused on the planned coordinated production deployment and final live evidence, not on missing core product functionality.
