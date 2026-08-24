# Gbolix Leads on Render and Neon

Gbolix Leads is a separate engine service. **Gbolix.site remains the customer login, Workspace, Wallet, billing, credit, and delivery application.** The Render engine accepts only signed Gbolix control-plane requests.

## Neon database

Create a separate Neon database named `gbolix_leads` in the existing Neon project, or create a separate Neon project for the engine. Do not point this service at the existing Gbolix Wallet database because the engine has its own independent schema.

In the Render service for `gbolix-leads-engine`, set `DATABASE_URL` to the connection string for that separate Neon database. The URL should include the Neon TLS parameters supplied in the Neon Connect panel.

Use this Render Build Command:

```bash
pnpm install --no-frozen-lockfile && pnpm -w run neon:migrate && pnpm run build
```

Use this Start Command:

```bash
pnpm run start
```

The `/health` endpoint returns the engine status and does not require customer OAuth.

## Required signed-control-plane variables

| Render service | Variable | Set to |
|---|---|---|
| Gbolix API | `GBOLIX_LEADS_ENGINE_URL` | The public HTTPS URL of this Leads Render service |
| Gbolix API | `GBOLIX_LEADS_SHARED_SECRET` | Secret A |
| Gbolix API | `GBOLIX_LEADS_CALLBACK_SECRET` | Secret B |
| Gbolix Leads engine | `GBOLIX_INTEGRATION_SECRET` | Same Secret A |
| Gbolix Leads engine | `GBOLIX_CONTROL_PLANE_CALLBACK_URL` | `https://api.gbolix.site/api/integrations/leads/events` |
| Gbolix Leads engine | `GBOLIX_CONTROL_PLANE_CALLBACK_SECRET` | Same Secret B |

Generate Secret A and Secret B separately. Keep them private. Rotate each direction independently.

## Object storage and AI

CSV/domain source preservation and exports need an S3-compatible bucket. Configure `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; add `S3_PUBLIC_BASE_URL` only if your bucket intentionally serves public objects. Exports otherwise use signed URLs.

AI enrichment remains optional. Set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` only when AI inference is ready. The engine records resulting values as `ai_inferred` observations and never overwrites source-verified fields.

## Global discovery sources and cost controls

The engine now accepts bounded multi-city discovery requests across countries. The approved low-cost public source is the OpenStreetMap adapter, with a maximum of 10 cities and 100 candidates per job. Coverage and results vary by country and category; the engine must not market this as a complete business census.

The official Google Places adapter is present but remains policy-gated. It is enabled only when both variables are set on the `gbolix-leads-engine` Render service:

```text
GOOGLE_PLACES_API_KEY=<server-side Google Places API key>
GOOGLE_PLACES_SOURCE_APPROVED=true
```

Before enabling it, create a Google Cloud project, enable Places API (New), configure billing and API restrictions, and review Google Places retention, attribution, and export policies. Google Places requests use field masks and a per-job maximum of 100 candidates. The adapter does not scrape Google Maps pages.

The source registry reports the following states to the control plane: `approved`, `candidate`, and `disabled`. A candidate source is never selected by a customer job. Paid sources must be enabled deliberately and should receive a workspace/job budget before production use.

The global workflow remains source-neutral: Gbolix.site sends country, regions, cities, category, keywords, requested limit, and source policy; the engine selects only approved adapters, preserves source provenance, deduplicates within the workspace, and emits final usage events back to Gbolix.site.
