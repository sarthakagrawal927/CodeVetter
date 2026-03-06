# AI Code Reviewer (Enterprise v1)

Enterprise control plane for GitHub-backed PR review automation.

## What Ships Now

- Platform-triggered GitHub Action (`platform_base_url` + `platform_token`)
- Cloudflare Worker API control plane with:
  - GitHub OAuth login/session
  - Workspace RBAC (`owner`, `admin`, `member`, `viewer`)
  - GitHub installation sync (org + personal account scope)
  - Workspace default rules + repository overrides
  - Pull request/review run tracking and manual triggers
  - Webhook ingestion with signature validation + delivery idempotency
  - Audit logs and encrypted workspace BYOK secret storage
- Next.js multi-page dashboard (`apps/dashboard`)
- Shared DB package (`packages/db`) with Cockroach/Postgres schema + migrations + typed adapters

## GitHub Action Quickstart (v1)

```yaml
name: Trigger Enterprise Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@v4
      - uses: sarthakagrawal927/code-reviewer-action@v1
        with:
          platform_base_url: ${{ secrets.CODE_REVIEWER_PLATFORM_BASE_URL }}
          platform_token: ${{ secrets.CODE_REVIEWER_PLATFORM_TOKEN }}
```

## Action Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `platform_base_url` | Yes | N/A | Platform API base URL |
| `platform_token` | Yes | N/A | Bearer token used for `/v1/actions/reviews/trigger` |
| `workflow_run_id` | No | `${{ github.run_id }}` fallback | Optional run id for traceability |
| `request_timeout_ms` | No | `15000` | API timeout in milliseconds |

Deprecated legacy v0 gateway inputs are intentionally rejected with a migration error.

## Monorepo Layout

```text
.
├── action.yml
├── src/
├── dist/
├── apps/
│   ├── dashboard/
│   └── landing-page/
├── packages/
│   ├── shared-types/
│   ├── db/
│   ├── ai-gateway-client/
│   └── review-core/
├── workers/
│   ├── api/
│   └── review/
└── docs/
```

## Build and Test

```bash
npm run build
npm test
npm run -w workers/api build
npm run -w apps/dashboard build
```

## CockroachDB Wiring

`workers/api` now uses CockroachDB when `COCKROACH_DATABASE_URL` is configured.
If it is not set (or `DB_USE_IN_MEMORY=true`), the API falls back to in-memory storage.

Apply schema migrations:

```bash
cockroach sql --url "$COCKROACH_DATABASE_URL" < packages/db/migrations/0001_init.sql
```

## Deployment (Source of Truth)

| Component | Platform | Project Name | Domain | Config File |
|-----------|----------|-------------|--------|-------------|
| **Dashboard** | Vercel | `dashboard` | app.codevetter.com | `apps/dashboard/.vercel/project.json` |
| **Landing Page** | Vercel | `landing-page` | codevetter.com | `apps/landing-page/.vercel/project.json` |
| **API Worker** | Cloudflare Workers | `code-reviewer-api` | api.codevetter.com | `workers/api/wrangler.toml` |
| **Review Worker** | Cloudflare Workers | `code-reviewer-worker` | (cron, no public URL) | `workers/review/wrangler.toml` |
| **Database** | CockroachDB | (managed) | — | via `COCKROACH_DATABASE_URL` secret |

### Vercel Project Linkage

Root `.vercel/project.json` points to `landing-page`. Dashboard and landing page are separate Vercel projects.

> **Note:** The `dashboard` and `landing-page` Vercel projects belong to code-reviewer **only**. SaaS Maker has its own separate Vercel project (`saasmaker-dashboard`).

## Roadmap Docs

- v0 details: `docs/v0-lite.md`
- v1 plan: `docs/v1-roadmap.md`
- v1 technical decisions: `docs/v1-technical-questions.md`
- v2 plan: `docs/v2-roadmap.md`
