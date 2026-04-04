<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/landing-page

Public marketing site for CodeVetter. A Next.js app (App Router) that presents the product, features, privacy story, FAQ, and a download CTA for the macOS desktop app.

Part of the [CodeVetter](../../README.md) monorepo.

## Usage

### Dev server

```bash
# From the repo root
npm run -w apps/landing-page dev
# or, inside this package
npm run dev
```

Opens at **http://localhost:3000**.

### Build & start production

```bash
npm run -w apps/landing-page build
npm run -w apps/landing-page start
```

## Page structure

The single page (`app/page.js`) renders the following sections in order:

1. **Nav** — sticky, links to GitHub and the latest release download
2. **Hero** — headline, sub-copy, Download for macOS / View Source CTAs
3. **Features** — three feature cards (Review, Feedback loop, Orchestration)
4. **How it works** — three-step flow (Point at code → AI reviews → Agent fixes)
5. **Privacy-first** — local-first architecture callouts, no-server diagram
6. **FAQ** — accordion with 7 questions
7. **CTA** — download prompt
8. **Footer** — product and community links

## Key scripts

| Script | Description |
|---|---|
| `dev` | Next.js dev server (port 3000) |
| `build` | Production bundle |
| `start` | Serve production build |

## Testing

No dedicated test runner is configured for this package. Smoke-test the build locally:

```bash
npm run -w apps/landing-page build && npm run -w apps/landing-page start
```
