# API Worker Skeleton (v1)

This worker is the hosted control-plane API skeleton for v1.

## Current Endpoints

- `GET /health`
- `GET /v1/orgs`
- `POST /v1/orgs`
- `POST /v1/github/connect-repository` (proper GitHub App installation-token repository connect)
- `GET /v1/orgs/:orgId/members`
- `POST /v1/orgs/:orgId/members`
- `GET /v1/orgs/:orgId/drift/check`
- `POST /v1/orgs/:orgId/drift/check` (manual drift check, no auto reconcile)
- `GET /v1/orgs/:orgId/reconcile`
- `POST /v1/orgs/:orgId/reconcile` (manual trigger after drift check)
- `GET /v1/repositories`
- `POST /v1/repositories`
- `GET /v1/rules/:repositoryId`
- `PUT /v1/rules/:repositoryId`
- `GET /v1/reviews`
- `POST /v1/reviews/trigger`
- `POST /webhooks/github`
- `GET /v1/webhooks/events`

All data is currently in-memory only.

## Run

```bash
npm run -w workers/api build
npm run -w workers/api start
```

Optional env vars:

- `API_WORKER_HOST` (default `127.0.0.1`)
- `API_WORKER_PORT` (default `8080`)
- `API_WORKER_AUTH_TOKEN` (if set, requires `Authorization: Bearer <token>`)
- `API_WORKER_CORS_ORIGIN` (default `*`, set your dashboard origin in production)
- `GITHUB_API_BASE_URL` (default `https://api.github.com`)
- `GITHUB_DRIFT_CHECK_TOKEN` (required for live GitHub drift check endpoint)

## Next Integration Steps

1. Replace in-memory store with Postgres adapter.
2. Replace static token env with GitHub App installation token mint/refresh flow.
3. Publish review/index jobs to durable queue.
4. Add authN/authZ for workspaces and org membership.
