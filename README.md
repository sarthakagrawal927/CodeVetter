<!-- generated-by: gsd-doc-writer -->
# CodeVetter

AI code review platform for agent-generated code — desktop-first, works offline.

## Installation

```bash
# Clone and install dependencies (uses npm workspaces)
git clone https://github.com/sarthakagrawal927/CodeVetter.git
cd CodeVetter
npm install
```

> Requires [Rust + Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites) for the desktop app.

## Quick Start

1. Install dependencies (see above)
2. Build shared packages:
   ```bash
   npm run build:packages
   ```
3. Launch the desktop app in development mode:
   ```bash
   cd apps/desktop && npm run tauri:dev
   ```
4. Add an AI provider API key (Anthropic, OpenAI, or OpenRouter) in Settings, then open the Review tab to run your first review.

## Usage Examples

**Run the desktop app (dev mode)**
```bash
cd apps/desktop
npm run tauri:dev
```

**Run Playwright end-to-end tests for the desktop app**
```bash
cd apps/desktop
npm test
```

**Deploy Cloudflare Workers**
```bash
# API worker
npm run deploy:api

# Review / indexing worker
npm run deploy:review
```

## Monorepo Structure

```
apps/
  desktop/          Tauri 2 + React 19 + Vite desktop app — the core product
  landing-page/     Next.js 15 marketing site (deployed to Vercel)
  dashboard/        Next.js 15 web dashboard (on hold, useful parts moving to desktop)

packages/
  review-core/      Shared review engine — scoring, prompts, parsing (pure functions, no I/O)
  ai-gateway-client/  OpenAI-compatible LLM API client used by desktop and workers
  db/               Database adapters — local SQLite (desktop), D1/Postgres (cloud)
  shared-types/     TypeScript types shared across all packages and apps

workers/
  api/              Cloudflare Worker REST API (Hono) — auth, workspaces, webhooks
  review/           Cloudflare Worker — async review queue and GitHub App webhook handling
```

## Tech Stack

| Layer | Technologies |
|---|---|
| Desktop frontend | React 19, Vite, Tailwind CSS, shadcn/ui |
| Desktop backend | Rust (Tauri 2), SQLite |
| Review engine | TypeScript — runs in the webview, no server required |
| Web apps | Next.js 15 |
| Workers | Cloudflare Workers, Hono |
| Testing | Playwright (e2e) |
| Package manager | npm workspaces |

## License

ISC (root package); MIT (landing-page template — Copyright 2022 Themesberg)
