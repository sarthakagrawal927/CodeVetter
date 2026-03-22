# CodeVetter Roadmap

> Desktop-first. Web later. Previous roadmap archived at `plans/2026-03-21-roadmap-pre-consolidation.md`.

## Completed

### Desktop App — Conductor Parity
- [x] Warm amber design system
- [x] Workspace architecture (3-column layout, git integration)
- [x] Multi-tab chat with persistence
- [x] Command palette (Cmd+K)
- [x] Real terminal (xterm.js + portable-pty)
- [x] File explorer + diff viewer
- [x] PR management + CI status via gh CLI
- [x] Diff commenting with inline line selection
- [x] Keyboard shortcuts + cheatsheet
- [x] Context meter, sidebar toggle, zen mode

### Beyond Conductor
- [x] CRDT multi-agent coordination (all 5 phases)
- [x] Linear OAuth integration
- [x] System resource monitor
- [x] Slash commands dropdown
- [x] Thinking/Plan/Fast mode toggles
- [x] Playwright test generator
- [x] Persona-based Agent Squad (from ~/.claude/agents/)
- [x] Floating pill nav bar
- [x] shadcn/ui component library setup

### Structure
- [x] Nav: Home, Workspaces, Board, History, Settings
- [x] Sessions -> History (read-only)
- [x] Kanban: To Do, In Progress, Review, Test
- [x] Agent Squad: persona cards with CRUD

### Cloud Platform (built, on hold)
- [x] Cloudflare Workers (API + review worker)
- [x] Landing page on Vercel
- [x] Dashboard on Vercel (to be deprecated)
- [x] CockroachDB + GitHub OAuth + webhooks

### Infrastructure
- [x] Husky pre-commit + pre-push hooks
- [x] ESLint flat config, Rust 0 warnings
- [x] .gitignore for target/, sidecar/, .env
- [x] git history cleaned (removed 2GB+ of build artifacts)

---

## Phase 1: Cleanup (current)

Remove dead code and simplify architecture.

- [x] Delete sidecar directory and all references
  - Removed sidecar spawning from `review.rs`, replaced with `get_local_diff` + `save_review`
  - Removed sidecar spawning from `mission.rs`, emits `task-review-requested` event instead
  - Removed `build:sidecar` script from `apps/desktop/package.json`
  - Removed `externalBin` from `tauri.conf.json`
  - Deleted `apps/desktop/src-tauri/sidecar/`
- [x] Audit Rust commands — all 21 files registered and wrapped, no orphans (some unused functions flagged for future cleanup)
- [x] Clean up unused React components
  - Deleted: activity-feed, status-bar, review-live, textarea, tabs, dropdown-menu (ui), Review page, PlaywrightGen page
- [x] shadcn/ui migration
  - Sessions.tsx: 6 raw buttons → Button
  - Workspaces.tsx: 4 raw buttons → Button
  - command-palette.tsx: input → Input, buttons → Button, kbd → Badge
  - Home.tsx + Settings.tsx: already ~90-95% compliant
- [ ] E2E smoke test: each nav page loads without errors

---

## Phase 2: Local Code Review

Wire review-core directly into the desktop webview. No sidecar, no server.

- [ ] Local repo indexing
  - Tree-sitter code chunking (reuse logic from `workers/review/`)
  - Index local repo files into SQLite (semantic chunks)
  - Incremental re-indexing on file changes (leverage existing file watcher)
  - Feed indexed context into review prompts (RAG)
- [ ] Review orchestration in React
  - User picks a local repo (directory picker via Tauri IPC)
  - Tauri Rust command: `get_local_diff(repo_path)` returns git diff
  - React imports `review-core.buildPrompt()` + `ai-gateway-client`
  - Calls LLM with user's configured API key + indexed context
  - `review-core.parseReviewResponse()` + `computeScore()`
  - Tauri Rust command: `save_review(findings, score)` to local SQLite
- [ ] Review results UI
  - Severity-ranked findings with file/line links
  - Approve/dismiss individual findings
  - Auto-generated summary (markdown)
  - Review history (list past reviews per repo)
- [ ] Settings: API key configuration
  - Support Anthropic, OpenAI, or custom gateway URL
  - Store securely (Tauri keychain or encrypted local storage)

---

## Phase 3: PR Review via GitHub PAT

Desktop-local PR review. No server, no OAuth, no webhooks.

- [ ] GitHub PAT configuration in Settings
  - Paste token, validate scopes, store securely
- [ ] PR picker UI
  - List user's repos (from PAT)
  - List open PRs for selected repo
  - Show PR metadata (title, author, changed files)
- [ ] PR review flow
  - `review-core.getPrDiffWithPat()` + `getPrFilesWithPat()`
  - Same review pipeline as local (buildPrompt -> LLM -> parse -> score)
  - Option to post review back to GitHub as PR comment
- [ ] Review dashboard
  - Cross-file analysis
  - Track review quality over time

---

## Phase 4: Conductor Polish

Strengthen the mission control / agent orchestration features.

- [ ] Symphony-style agent orchestration
  - WORKFLOW.md per-repo
  - Auto-polling Linear (continuous, not manual import)
  - Retry with exponential backoff
  - Reconciliation (stop agents when issues close)
  - Per-issue workspace isolation
  - Concurrency limits
  - Multi-turn agent sessions
- [ ] Live session detection (match Claude processes to sessions by cwd)
- [ ] Auto-trigger usage refresh (periodic, not manual)
- [ ] Update Playwright e2e tests for current UI

---

## Phase 5: Web App (later)

Strip down desktop app into a hosted web version.

- [ ] Abstract Tauri IPC behind provider pattern (Tauri vs HTTP)
- [ ] Fold useful dashboard pages into shared React app
  - Workspace RBAC (members, audit, rules)
  - GitHub onboarding flow
  - Repository management
- [ ] GitHub App integration (team-scale, webhook-driven)
- [ ] Deploy web variant to Vercel (same React app, no Tauri)
- [ ] Delete apps/dashboard/
- [ ] Re-verify workers/api + workers/review deployments
- [ ] Embeddings & RAG for enhanced review context

---

## Not Doing

- ~~Go sidecar~~ — unnecessary, review-core runs in webview
- ~~Bun-compiled sidecar binary~~ — eliminated, 61MB for no reason
- ~~Separate web dashboard~~ — will be same codebase as desktop
- ~~Supabase~~ — using CockroachDB/D1
