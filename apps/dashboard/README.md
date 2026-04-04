<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/dashboard

Enterprise control-plane dashboard for CodeVetter. A Next.js App Router application that lets teams manage workspaces, review agent pull requests, configure rules, and administer members and audit logs.

Part of the [CodeVetter](../../README.md) monorepo.

## Usage

### Dev server

```bash
# From the repo root
npm run -w apps/dashboard dev
# or, inside this package
npm run dev
```

Runs on **http://localhost:4174**.

### Build

```bash
# From the repo root (builds shared-types first, then the dashboard)
npm run -w apps/dashboard build
```

### Start production server

```bash
npm run -w apps/dashboard start
```

## Environment variables

Copy `.env.example` and fill in the values:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Backend API base URL (defaults to relative if omitted) |
| `NEXT_PUBLIC_SAASMAKER_API_KEY` | SaaS Maker analytics project key |

## Routes

| Path | Description |
|---|---|
| `/` | Home — feature overview and "Start Reviewing" entry point |
| `/login` | Authentication |
| `/onboarding` | GitHub App install flow |
| `/w/[workspaceSlug]/overview` | Workspace overview |
| `/w/[workspaceSlug]/repositories` | Connected repositories |
| `/w/[workspaceSlug]/rules` | Review rule configuration |
| `/w/[workspaceSlug]/pull-requests` | PR review queue |
| `/w/[workspaceSlug]/settings/members` | Member management |
| `/w/[workspaceSlug]/settings/audit` | Audit log |

## Key scripts

| Script | Description |
|---|---|
| `dev` | Start Next.js dev server on port 4174 |
| `build` | Build shared-types then production bundle |
| `start` | Serve production build on port 4174 |

## Testing

This package has no dedicated test runner configured. Run lint and type-check from the repo root:

```bash
# Type-check
npx tsc --noEmit -p apps/dashboard/tsconfig.json
```
