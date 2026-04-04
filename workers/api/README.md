<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/worker-api

Control-plane HTTP API for CodeVetter — handles authentication, workspace tenancy, GitHub App integration, review rules, PR tracking, and webhook ingestion.

Part of the [CodeVetter](../../README.md) monorepo.

## Purpose

This Cloudflare Worker is the primary backend API for CodeVetter. It is the single service that the dashboard calls for all operations: GitHub OAuth login, workspace and member management, repository syncing, review rule configuration, and PR/review-run queries. It also receives GitHub App webhooks and exposes a platform action endpoint for triggering reviews programmatically.

Built with [Hono](https://hono.dev) and backed by Cloudflare D1.

Deployed at: `api.codevetter.com`

## Usage

### Local development

```bash
pnpm --filter @code-reviewer/worker-api dev
# or from the monorepo root:
pnpm -w workers/api dev
```

Wrangler starts a local dev server using `wrangler dev` with the config in `wrangler.toml`.

### Deploy

```bash
pnpm --filter @code-reviewer/worker-api deploy
```

### Build (TypeScript compile only)

```bash
pnpm --filter @code-reviewer/worker-api build
```

## Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/auth/github/start` | Begin GitHub OAuth flow |
| `GET` | `/v1/auth/github/callback` | OAuth callback — sets session cookie |
| `GET` | `/v1/auth/session` | Return current session info |
| `POST` | `/v1/auth/logout` | Destroy session |

### Workspaces and Members
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/workspaces` | List workspaces for the current user |
| `POST` | `/v1/workspaces` | Create a workspace |
| `GET` | `/v1/workspaces/:workspaceId` | Get workspace details |
| `GET` | `/v1/workspaces/:workspaceId/members` | List workspace members |
| `POST` | `/v1/workspaces/:workspaceId/invites` | Send an invite |
| `PATCH` | `/v1/workspaces/:workspaceId/members/:memberId` | Update member role |

### GitHub and Repositories
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/workspaces/:workspaceId/github/installations` | List GitHub App installations |
| `POST` | `/v1/workspaces/:workspaceId/github/sync` | Sync repositories from GitHub |
| `GET` | `/v1/workspaces/:workspaceId/repositories` | List repositories |
| `POST` | `/v1/workspaces/:workspaceId/repositories/:repositoryId/indexing/trigger` | Trigger indexing run |

### Rules
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/workspaces/:workspaceId/rules/default` | Get workspace-level default rules |
| `PUT` | `/v1/workspaces/:workspaceId/rules/default` | Update workspace-level default rules |
| `GET` | `/v1/repositories/:repositoryId/rules` | Get repository-level rules |
| `PUT` | `/v1/repositories/:repositoryId/rules` | Update repository-level rules |
| `GET` | `/v1/repositories/:repositoryId/rules/effective` | Get merged effective rules |

### PRs and Reviews
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/repositories/:repositoryId/pull-requests` | List pull requests |
| `GET` | `/v1/pull-requests/:pullRequestId/reviews` | List review runs for a PR |
| `POST` | `/v1/pull-requests/:pullRequestId/reviews/trigger` | Manually trigger a review |
| `GET` | `/v1/review-runs/:reviewRunId/findings` | Get findings for a review run |

### Security and Ops
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/webhooks/github` | GitHub App webhook receiver |
| `POST` | `/v1/actions/reviews/trigger` | Platform action — trigger review |
| `GET` | `/v1/workspaces/:workspaceId/audit` | Audit log |
| `PUT` | `/v1/workspaces/:workspaceId/secrets/gateway` | Store AI gateway secret |
| `GET` | `/v1/workspaces/:workspaceId/secrets/gateway` | Retrieve AI gateway secret metadata |

## Configuration

### Cloudflare Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | `codevetter` D1 database (id: `79f405dc-aefe-495b-883c-1f7623f0f0bf`) |

### Environment Variables (non-secret, set in `wrangler.toml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_BASE_URL` | `https://app.codevetter.com` | Frontend base URL — used in OAuth redirects |
| `API_WORKER_CORS_ORIGIN` | `https://app.codevetter.com` | Allowed CORS origin |
| `SESSION_COOKIE_DOMAIN` | `.codevetter.com` | Domain scope for the session cookie |
| `GITHUB_API_BASE_URL` | `https://api.github.com` | GitHub API base (override for GHE) |
| `SESSION_TTL_HOURS` | `168` | Session lifetime in hours (default: 7 days) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `120` | Max requests per window per IP |
| `DB_USE_IN_MEMORY` | `false` | Force in-memory DB adapter (dev only) |

### Secrets (upload with `wrangler secret put <NAME>`)

| Secret | Description |
|--------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `GITHUB_WEBHOOK_SECRET` | Shared secret for verifying GitHub webhook payloads |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM, `\n` escaped) |
| `SESSION_SECRET` | HMAC secret for signing session tokens |
| `PLATFORM_ACTION_TOKEN` | Bearer token for the `/v1/actions/reviews/trigger` endpoint |
| `WORKSPACE_SECRET_ENCRYPTION_KEY` | Key for encrypting per-workspace AI gateway secrets |

## Key Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `tsc -p tsconfig.json` | Compile TypeScript |
| `dev` | `wrangler dev` | Run locally with Wrangler |
| `deploy` | `wrangler deploy` | Deploy to Cloudflare Workers |
