<!-- generated-by: gsd-doc-writer -->
# Getting Started

This guide walks you through setting up the CodeVetter monorepo locally and running the desktop app for the first time.

---

## Prerequisites

### Runtime tools

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | `>= 18.0.0` | `v22.x` used in active development |
| npm | `>= 9.0.0` | Workspaces feature is required |
| Rust | `>= 1.70.0` (stable) | `1.94.x` used in active development; install via [rustup](https://rustup.rs) |
| Cargo | ships with Rust | — |

### Tauri system dependencies (desktop app only)

The desktop app (`apps/desktop`) is built with **Tauri 2**. Before the first build, install the platform prerequisites documented at [https://tauri.app/start/prerequisites/](https://tauri.app/start/prerequisites/).

On macOS (the primary target, minimum `10.15`):

```bash
# Xcode Command Line Tools — required for Tauri native compilation
xcode-select --install
```

### Optional tools

- **wrangler** — required only if you want to develop or deploy the Cloudflare Workers (`workers/api`, `workers/review`). Install with `npm install -g wrangler`.
- **git** — required; Tauri's Rust backend shells out to `git diff` at runtime.

---

## Installation

1. Clone the repository:

```bash
git clone https://github.com/sarthakagrawal927/CodeVetter.git
cd CodeVetter
```

2. Install all workspace dependencies (root + all apps, packages, and workers):

```bash
npm install
```

   npm workspaces resolves packages declared as `file:` references automatically. No separate install step is needed inside individual packages.

3. Build the shared TypeScript packages. The desktop app resolves these via Vite path aliases during `dev`, but other apps and workers need the compiled output:

```bash
npm run build:packages
```

   This runs `build:types → build:db → build:gateway → build:review-core` in order.

4. Copy the environment variable template and fill in values as needed:

```bash
cp .env.example .env
```

   For the dashboard app, copy its own template as well:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

   See [docs/CONFIGURATION.md](CONFIGURATION.md) for descriptions of every variable.

---

## First Run

### Desktop app (primary product)

Launch the Tauri + React desktop app in development mode:

```bash
cd apps/desktop
npm run tauri:dev
```

Tauri will:
1. Start the Vite dev server on port `1420`.
2. Compile the Rust backend and open a native window pointing at `http://localhost:1420`.

The first Rust compilation takes several minutes. Subsequent starts are fast.

Once the window opens, go to **Settings** and enter an AI provider API key (Anthropic, OpenAI, or OpenRouter) to enable code review functionality.

### Next.js dashboard (optional)

```bash
cd apps/dashboard
npm run dev
```

Dashboard runs on port `4174`. It expects `NEXT_PUBLIC_API_BASE_URL` to point at a running API worker (defaults to `http://127.0.0.1:8787`).

### Next.js landing page (optional)

```bash
cd apps/landing-page
npm run dev
```

### Cloudflare Workers (optional)

```bash
# API worker — runs on http://127.0.0.1:8787 by default
cd workers/api
npm run dev

# Review worker
cd workers/review
npm run dev
```

---

## Common Setup Issues

### 1. Rust/Tauri compilation fails on first `tauri:dev`

**Symptom:** `cargo build` errors mentioning missing system libraries, linker errors, or Xcode toolchain issues.

**Solution:** Make sure Xcode Command Line Tools are installed and up to date:

```bash
xcode-select --install
# If already installed, reset the path
sudo xcode-select --reset
```

Then verify Tauri prerequisites at [https://tauri.app/start/prerequisites/](https://tauri.app/start/prerequisites/). For Apple Silicon Macs the sidecar binary bundled in `apps/desktop/src-tauri/binaries/` is `aarch64-apple-darwin` — no additional steps are needed.

### 2. `npm run build:packages` fails with "Cannot find module"

**Symptom:** TypeScript errors referencing types from sibling packages during `build:packages`.

**Solution:** The packages must build in order (`shared-types` first, then `db` and `ai-gateway-client`, then `review-core`). The root `build:packages` script enforces this order. If you ran individual package build commands out of order, reset with:

```bash
npm run build:packages
```

If the error persists, delete compiled output and rebuild:

```bash
find packages -name dist -type d -exec rm -rf {} + 2>/dev/null; npm run build:packages
```

### 3. Missing environment variables cause worker startup failures

**Symptom:** `wrangler dev` throws validation errors such as `AI_GATEWAY_MODEL must not be empty` or `Invalid REVIEW_WORKER_POLL_MS`.

**Solution:** Copy `.env.example` to `.env` and populate required values. For local worker development the minimum required secrets are:

- `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_API_KEY` — without these, review jobs are skipped.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` — without these, OAuth routes throw at invocation.

Non-secret defaults (e.g. `AI_GATEWAY_MODEL`) are already set in each worker's `wrangler.toml` `[vars]` block and do not need to be in `.env`.

### 4. Port `1420` already in use

**Symptom:** Vite fails to bind with `EADDRINUSE: address already in use :::1420`.

**Solution:** The desktop `dev` script already kills any process on port `1420` before starting (`lsof -ti:1420 | xargs kill -9`). If the error persists, kill the process manually:

```bash
lsof -ti:1420 | xargs kill -9
```

Or override the port in `apps/desktop/vite.config.ts` (`server.strictPort` is `false`, so Vite will auto-increment to the next available port if the kill fails).

---

## Next Steps

- **Architecture** — how the monorepo is structured and how data flows through the system: [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- **Configuration** — full reference for every environment variable, Cloudflare Worker binding, and config file: [docs/CONFIGURATION.md](CONFIGURATION.md)
- **Running tests** — Playwright e2e tests for the desktop app:

```bash
cd apps/desktop
npm test
```

- **Deploying workers** — from the repo root:

```bash
npm run deploy:api     # workers/api → Cloudflare
npm run deploy:review  # workers/review → Cloudflare
```
