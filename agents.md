# agents.md — CodeVetter

## Purpose
AI desktop code review tool for agent-generated code — runs offline as a Tauri binary, reviews diffs with pluggable LLM providers.

## Stack
- Framework: Tauri 2 (Rust backend) + React 19 + Vite (desktop frontend)
- Language: TypeScript (frontend), Rust (backend)
- Styling: Tailwind CSS v3 + shadcn/ui (Radix + CVA), warm amber accent (#d4a039)
- DB: SQLite via `@tauri-apps/plugin-sql` (local only, no server)
- Auth: None (local desktop app; LLM API keys stored in user settings)
- Testing: Playwright (e2e)
- Deploy: GitHub Releases (Tauri build + `@tauri-apps/plugin-updater` auto-updater)
- Package manager: npm workspaces (root) — NOT pnpm

## Repo structure
```
apps/
  desktop/              # Tauri 2 + React 19 desktop app (the active product)
    src/                # React frontend: components/, lib/, pages/, App.tsx
    src-tauri/          # Rust backend: src/main.rs, commands/, db/, talk.rs
    src/lib/tauri-ipc.ts  # Typed invoke() wrappers for all Tauri commands
    vite.config.ts      # Vite config
    playwright.config.ts # e2e test config
    tests/              # Playwright e2e tests
docs/                   # Architecture, testing, development docs
.github/workflows/
  ci.yml                # Lint + Playwright tests
  release.yml           # Tauri platform binaries → GitHub Releases
.planning/codebase/     # Architecture, conventions, integrations
```

## Key commands
```bash
# From apps/desktop/
npm run dev           # Vite dev server (port 1420)
npm run tauri:dev     # Full Tauri app in dev mode (requires Rust toolchain)
npm run tauri:build   # Production Tauri binary
npm run test          # Playwright e2e tests
npm run lint          # ESLint

# From repo root
npm install           # Install all workspace deps
```

## Architecture notes
- **Desktop binary, no server.** Review engine runs entirely in the webview (TypeScript). Works offline.
- **Multi-LLM provider**: Anthropic, OpenAI, OpenRouter. Keys stored in user settings.
- **Tauri IPC**: all Rust commands called via typed wrappers in `src/lib/tauri-ipc.ts` → `invoke()` → `src-tauri/src/commands/`.
- **`isTauriAvailable()` guard**: all IPC calls wrapped so React code also works in plain browser.
- **FIXED**: Dead `@code-reviewer/*` workspace deps removed — `packages/` dir no longer exists and is no longer referenced. Build passes.
- **Active screens**: Dashboard (usage/token analytics), History (session search), Review (`/review` — AI code review with diff + fix). Other tabs (Board, Workspaces) are legacy — do not invest in them.
- **GH Actions**: `ci.yml` runs lint + Playwright; `release.yml` builds platform binaries and uploads to GitHub Releases.
- Husky pre-commit runs lint-staged on `apps/desktop/src/**/*.{ts,tsx}`; pre-push hook also configured.

## Active context
