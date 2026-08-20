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
