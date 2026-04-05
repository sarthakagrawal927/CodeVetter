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
- **Database**: Local SQLite (desktop), Cloudflare D1 (cloud)
- **Testing**: Vitest (unit), Playwright (e2e)
- **Package manager**: npm workspaces

## Key Conventions
- `isTauriAvailable()` guards all Tauri IPC calls — same React code works in browser
- Tauri IPC is in `apps/desktop/src/lib/tauri-ipc.ts` (typed wrappers around `invoke()`)
- Rust commands are in `apps/desktop/src-tauri/src/commands/`
- Agent personas loaded from `~/.claude/agents/` (markdown + YAML frontmatter)
- review-core is pure functions — no side effects, no I/O (except GitHub API reads)

## Current Focus
Desktop app — three active tabs only:
1. **Dashboard** — provider usage (Claude rate limits, Gemini local token counts, Codex)
2. **History** — session indexing + full-text search (Claude + Codex)
3. **Review** (`/review`) — CLI-agent-powered code review with findings, code viewer, fix with AI, diff view, revert

Other tabs (Board, Workspaces, old Reviews) are legacy — do not invest in them.

## What NOT to do
- Don't add server dependencies to desktop features — desktop works offline
- Don't use the sidecar pattern — import review-core directly in the webview
- Don't modify apps/landing-page without explicit request
- Don't add Supabase, Webpack, or yarn
- Don't commit .env files, API keys, or the Rust target/ directory
- Don't invest in Board, Workspaces, or old Reviews pages — they are legacy
- Don't add features to review-core API pipeline — the active review flow uses CLI agents (claude -p, gemini -p)
