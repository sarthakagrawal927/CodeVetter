# v0 Lite: BYOK Gateway Review

v0 Lite is a stateless GitHub Action mode.

- Bring your own AI gateway key.
- Review only the current PR diff.
- Post one summary comment and top inline findings.
- No dashboard or backend persistence required.

## Required Inputs

- `github_token`
- `ai_api_key`

## Optional Inputs

- `ai_base_url` (defaults to `https://api.openai.com/v1`)
- `model` (default `gpt-4o-mini`)
- `max_inline_findings` (default `5`)
- `min_inline_severity` (default `medium`)
- `review_tone` (default `balanced`)
- `fail_on_findings` (default `false`)
- `fail_on_severity` (default `high`)

## Workflow Example

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

## Gateway Examples

### Vercel AI Gateway style

```text
AI_BASE_URL=https://<your-vercel-gateway-host>/v1
```

### Cloudflare AI Gateway style

```text
AI_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai
```

### Bitfrost style

```text
AI_BASE_URL=https://<your-bitfrost-host>/v1
```

Use the same secret wiring for `AI_API_KEY` across all gateway options.
