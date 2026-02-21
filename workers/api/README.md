# API Worker Skeleton (v1)

This worker is the hosted control-plane API skeleton for v1.

## Current Endpoints

- `GET /health`
- `GET /v1/orgs`
- `POST /v1/orgs`
- `GET /v1/orgs/:orgId/members`
- `POST /v1/orgs/:orgId/members`
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

## Next Integration Steps

1. Replace in-memory store with Postgres adapter.
2. Add GitHub App signature verification in `/webhooks/github`.
3. Publish review/index jobs to durable queue.
4. Add authN/authZ for workspaces and org membership.
