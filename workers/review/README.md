<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/worker-review

Asynchronous execution-plane worker for CodeVetter — processes indexing and review jobs triggered by GitHub pull request events.

Part of the [CodeVetter](../../README.md) monorepo.

## Purpose

This Cloudflare Worker runs on a cron schedule (every minute) and also accepts GitHub App webhooks directly. Each invocation pulls queued indexing and review jobs from Cloudflare D1 and processes them:

- **Indexing jobs** — fetch a repository's file tree from GitHub via the App installation token, chunk each source file using Tree-sitter syntax parsing (functions/classes/modules), and persist the resulting `IndexedFile` and `SemanticChunk` records to D1.
- **Review jobs** — fetch the PR diff and changed files from GitHub, call the AI gateway (`@code-reviewer/ai-gateway-client`) for analysis, compute a composite score, persist findings, resolve findings from prior runs when they disappear, and post a GitHub PR review with inline comments.

The worker also exposes two HTTP endpoints: a `/webhook` handler for GitHub App `pull_request` events and a `/health` liveness check.

## Usage

### Local development

```bash
pnpm --filter @code-reviewer/worker-review dev
# or from the monorepo root:
pnpm -w workers/review dev
```

Wrangler starts a local dev server using `wrangler dev` with the config in `wrangler.toml`.

### Deploy

```bash
pnpm --filter @code-reviewer/worker-review deploy
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook` | GitHub App webhook receiver — enqueues review jobs for `pull_request` `opened`/`synchronize` events |
| `GET` | `/health` | Liveness check — returns `200 OK` |

## Configuration

### Cloudflare Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | `codevetter` D1 database (id: `79f405dc-aefe-495b-883c-1f7623f0f0bf`) — used as both job queue and persistent store |

### Triggers

Cron: `* * * * *` (every minute). Each scheduled invocation pulls up to 5 indexing jobs and 5 review jobs from D1 and processes them.

### Environment Variables (non-secret, set in `wrangler.toml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_API_BASE_URL` | `https://api.github.com` | GitHub API base (override for GHE) |
| `AI_GATEWAY_MODEL` | `llama-3.3-70b-versatile` | Model identifier forwarded to the AI gateway |

### Runtime Tuning Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REVIEW_WORKER_MAX_RETRIES` | `3` | Max retry attempts per job |
| `INDEX_MAX_FILE_BYTES` | `10485760` (10 MB) | Skip files larger than this during indexing |
| `INDEX_MAX_CHUNK_LINES` | `220` | Maximum lines per Tree-sitter chunk |

### Secrets (upload with `wrangler secret put <NAME>`)

| Secret | Description |
|--------|-------------|
| `GITHUB_APP_ID` | GitHub App ID — required to obtain installation tokens |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM, `\n` escaped) |
| `AI_GATEWAY_BASE_URL` | Base URL of the AI gateway service |
| `AI_GATEWAY_API_KEY` | API key for the AI gateway |

If `AI_GATEWAY_BASE_URL` or `AI_GATEWAY_API_KEY` are absent, review jobs are skipped with a warning. If `GITHUB_APP_ID` or `GITHUB_APP_PRIVATE_KEY` are absent, both indexing and review jobs are skipped.

## Key Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `wrangler dev` | Run locally with Wrangler |
| `deploy` | `wrangler deploy` | Deploy to Cloudflare Workers |
