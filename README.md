# AI Code Reviewer

Public GitHub Action for PR reviews with a v0 Lite mode and a future-ready monorepo structure.

## Current Product Stages

- `v0 Lite` (implemented): BYOK, OpenAI-compatible gateway, diff-only review, summary + top inline findings.
- `v1` (planned): hosted dashboard and rules platform.
- `v2` (planned): codebase evolution intelligence.

## v0 Lite Quickstart

```yaml
name: AI Review Lite
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: sarthakagrawal927/code-reviewer-action@v0
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          ai_base_url: ${{ secrets.AI_BASE_URL }}
          ai_api_key: ${{ secrets.AI_API_KEY }}
          model: "gpt-4o-mini"
          max_inline_findings: "5"
          min_inline_severity: "medium"
```

## Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `github_token` | Yes | `${{ github.token }}` | GitHub token for PR read/comment APIs |
| `ai_base_url` | No | `https://api.openai.com/v1` | OpenAI-compatible gateway base URL |
| `ai_api_key` | Yes | N/A | Gateway key |
| `model` | No | `gpt-4o-mini` | Model id exposed by your gateway |
| `max_inline_findings` | No | `5` | Upper limit for inline comments |
| `min_inline_severity` | No | `medium` | `low|medium|high|critical` |
| `review_tone` | No | `balanced` | `strict|balanced|friendly` |
| `fail_on_findings` | No | `false` | Fail check if threshold is hit |
| `fail_on_severity` | No | `high` | Threshold when `fail_on_findings=true` |

## Monorepo Layout

```text
.
├── action.yml
├── src/
├── dist/
├── apps/
│   ├── dashboard/
│   └── landing-page/
├── packages/
│   ├── shared-types/
│   ├── ai-gateway-client/
│   └── review-core/
├── workers/
│   ├── api/
│   └── review/
└── docs/
    ├── v0-lite.md
    └── v2-roadmap.md
```

## Development

### Build

```bash
npm run build
```

This builds shared packages first, then bundles the root action to `dist/index.js`.

### Landing Page Preview

```bash
python3 -m http.server 4173 --directory apps/landing-page
```

Open `http://localhost:4173`.

## Docs

- v0 details: `docs/v0-lite.md`
- v2 roadmap: `docs/v2-roadmap.md`
