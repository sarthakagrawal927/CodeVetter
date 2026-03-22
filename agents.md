# CodeVetter — Agent Context

## What is this?
CodeVetter is an AI code review platform. Desktop-first (Tauri + React), with a web variant planned later.

## Architecture
Monorepo with:
- `apps/desktop/` — Tauri + React + Vite desktop app (THE product)
- `apps/landing-page/` — Next.js marketing site
- `apps/dashboard/` — Next.js web dashboard (being deprecated, useful parts to fold into desktop)
- `workers/api/` — Cloudflare Worker, Hono REST API (auth, workspaces, webhooks)
- `workers/review/` — Cloudflare Worker, async review/indexing queue
- `packages/review-core/` — Shared review logic (scoring, prompts, parsing) — used by desktop AND workers
- `packages/ai-gateway-client/` — LLM API client (OpenAI-compatible)
- `packages/db/` — Database abstraction (D1, Postgres, in-memory)
- `packages/shared-types/` — TypeScript types shared across all packages

## Tech Stack
- **Desktop**: Tauri 2 (Rust backend) + React 19 + Vite + React Router
- **Styling**: Tailwind CSS + shadcn/ui, warm amber accent (#d4a039), dark backgrounds
- **Web**: Next.js 15 (landing page), Hono (API worker)
- **Database**: Local SQLite (desktop), CockroachDB/D1 (cloud)
- **Testing**: Vitest (unit), Playwright (e2e)
- **Package manager**: npm workspaces

## Key Conventions
- `isTauriAvailable()` guards all Tauri IPC calls — same React code works in browser
- Tauri IPC is in `apps/desktop/src/lib/tauri-ipc.ts` (typed wrappers around `invoke()`)
- Rust commands are in `apps/desktop/src-tauri/src/commands/`
- Agent personas loaded from `~/.claude/agents/` (markdown + YAML frontmatter)
- review-core is pure functions — no side effects, no I/O (except GitHub API reads)

## Current Focus
Desktop app — four pillars:
1. Usage/session history (done)
2. Local code review via review-core (building)
3. Conductor / mission control (partial)
4. PR review via GitHub PAT (planned)

## What NOT to do
- Don't add server dependencies to desktop features — desktop works offline
- Don't use the sidecar pattern — import review-core directly in the webview
- Don't modify apps/landing-page without explicit request
- Don't add Supabase, Webpack, or yarn
- Don't commit .env files, API keys, or the Rust target/ directory
