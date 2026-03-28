# Security Audit — CodeVetter (2026-03-28)

## P0 — Critical

- [x] **Session secret fallback to hardcoded string**
  `workers/api/src/index.ts:118` — `getSessionSecret()` falls back to `'local-dev-session-secret'` when `SESSION_SECRET` is unset. In production this means sessions are signed with a known, predictable key.
  **Fix:** Remove fallback, throw if `SESSION_SECRET` is not configured.

- [x] **API worker missing D1 database binding**
  `workers/api/wrangler.toml` — No `[[d1_databases]]` section. The review worker has it (`database_id = "79f405dc-aefe-495b-883c-1f7623f0f0bf"`), but the API worker does not. Any D1 query from the API worker will fail at runtime.
  **Fix:** Add matching `[[d1_databases]]` binding.

- [x] **Tauri updater pubkey is empty**
  `apps/desktop/src-tauri/tauri.conf.json:33` — `"pubkey": ""` means update signature verification is effectively bypassed. Without a real key, the updater plugin should be disabled entirely.
  **Fix:** Remove updater plugin config and revoke updater capability permissions.

- [ ] **Webhook signature validation silently disabled**
  `workers/api/src/index.ts:63-64` — When `GITHUB_WEBHOOK_SECRET` is missing, webhook verification is skipped with only a `console.warn`. An attacker can forge webhook payloads.
  **Fix:** (Tracked, not in scope for this sprint — requires deployment coordination.)

## P1 — High

- [x] **CSP disabled (null) in Tauri**
  `apps/desktop/src-tauri/tauri.conf.json:26` — `"csp": null` disables all Content Security Policy. The webview is open to XSS if any user-controlled content is rendered.
  **Fix:** Set restrictive CSP: `default-src 'self'; script-src 'self'; connect-src 'self' https://api.codevetter.com https://api.github.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:`.

- [x] **No React ErrorBoundary in desktop app**
  `apps/desktop/src/App.tsx` — Route-level ErrorBoundary added wrapping Outlet. Root-level boundary already existed in main.tsx (enhanced with retry button).
  **Fix:** Added `RouteErrorBoundary` in App.tsx around `<Outlet />`.

- [x] **CORS origin falls back to wildcard `*`**
  `workers/api/src/config.ts:20` — `corsOrigin` defaults to `'*'` when `API_WORKER_CORS_ORIGIN` is unset. In local dev this may be fine, but if the env var is ever missing in prod, CORS is wide open.
  **Fix:** Default to `'https://app.codevetter.com'` instead of `'*'`.

## P2 — Medium

- [ ] **Webhook secret validation only warns, does not block**
  `workers/api/src/index.ts:63` — Missing `GITHUB_WEBHOOK_SECRET` logs a warning but allows the worker to start and process unverified webhooks.

- [ ] **SaaS Maker API key committed in `.env.local`**
  `apps/dashboard/.env.local` — Contains `NEXT_PUBLIC_SAASMAKER_API_KEY=pk_64e3d...`. File is gitignored (not tracked), but it exists on disk. Verify this is a public/publishable key (the `pk_` prefix suggests it is). No action needed unless it is a secret key.

## P3 — Low / Informational

- [ ] **No `.env.example` for workers**
  `workers/api/` and `workers/review/` lack `.env.example` files. Secret names are documented in `wrangler.toml` comments, but a `.env.example` (or `.dev.vars.example`) would be clearer for contributors.

- [ ] **No pre-push hooks configured**
  No git hooks for lint, test, or secret scanning are set up. Consider adding husky + lint-staged or lefthook.

## Secrets in Git

- **No secrets found in git history.** Checked for `.env`, `.env.local`, `.dev.vars` — none were ever committed.
- `.gitignore` correctly covers `.env`, `.env.local`, `.env.*.local`, `.dev.vars`, `.claude/settings.local.json`.
- `apps/dashboard/.env.local` exists on disk but is untracked (verified via `git ls-files`).

## Deployment Gaps

- ~~**Updater plugin enabled without signing key**~~ — Fixed: updater plugin removed from config and capabilities.
- ~~**API worker has no D1 binding**~~ — Fixed: D1 binding added to API worker wrangler.toml.
