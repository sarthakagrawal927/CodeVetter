# AI Code Reviewer

Public GitHub Action for AI PR review.

This repo currently ships **v0 Lite** and keeps a monorepo skeleton ready for **v1/v2**.

## v0 Lite (Shipped)

`v0` is intentionally small and fast to adopt:

- BYOK via OpenAI-compatible gateway (`ai_base_url` + `ai_api_key`)
- Runs on pull requests, reviews only the PR diff
- Posts one summary comment + top inline findings
- No backend, no persistence, no app signup

## Why v0 Looks Like This

- **BYOK first**: avoids vendor lock-in and removes key-hosting liability for us.
- **Diff-only scope**: faster runtime and lower token cost per PR.
- **Summary + inline output**: keeps signal in-context for reviewers.
- **Stateless architecture**: simplest install and lowest ops burden.
- **Advisory default**: non-blocking by default, optional fail gate when teams are ready.

## v0 Reliability and Quality Guards

- Summary comment is **idempotent** (reruns update previous bot summary).
- Gateway call has **retry + backoff** for transient errors.
- Findings are filtered to be **changed-line grounded**.
- Speculative/cosmetic rename-style suggestions are suppressed.

## Quickstart

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

Use `@v0` for rolling latest v0 updates, or pin an immutable release tag such as `@v0.0.1`.

## Inputs

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| `github_token` | Yes | `${{ github.token }}` | GitHub token for PR read/comment APIs |
| `ai_base_url` | No | `https://api.openai.com/v1` | OpenAI-compatible gateway base URL |
| `ai_api_key` | Yes | N/A | Gateway API key |
| `model` | No | `gpt-4o-mini` | Model id exposed by your gateway |
| `max_inline_findings` | No | `5` | Upper limit for inline comments |
| `min_inline_severity` | No | `medium` | `low|medium|high|critical` |
| `review_tone` | No | `balanced` | `strict|balanced|friendly` |
| `fail_on_findings` | No | `false` | Fail check if threshold is hit |
| `fail_on_severity` | No | `high` | Threshold when `fail_on_findings=true` |
| `gateway_max_retries` | No | `1` | Retry count for transient gateway failures (`0-3`) |

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
```

## Build and Test

```bash
npm run build
npm test
```

## Roadmap Docs

- v0 details: `docs/v0-lite.md`
- v1 plan: `docs/v1-roadmap.md`
- v2 plan: `docs/v2-roadmap.md`
