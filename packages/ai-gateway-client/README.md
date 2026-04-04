<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/ai-gateway-client

HTTP client that sends PR diffs to any OpenAI-compatible AI gateway and returns structured review findings.

Part of the [CodeVetter](../../README.md) monorepo.

## Usage

```ts
import { AIGatewayClient } from '@code-reviewer/ai-gateway-client';
import type { GatewayConfig, GatewayReviewRequest } from '@code-reviewer/shared-types';

const config: GatewayConfig = {
  baseUrl: 'https://your-gateway.example.com/v1',
  apiKey: process.env.GATEWAY_API_KEY!,
  model: 'gpt-4o',
  reviewTone: 'balanced',
};

const client = new AIGatewayClient(config);

const response = await client.reviewDiff({
  diff: rawDiffString,
  files: [{ path: 'src/foo.ts', status: 'modified' }],
  context: {
    repoFullName: 'acme/my-repo',
    prNumber: 42,
    reviewTone: 'strict',
    agent: { isAgentAuthored: true, agentName: 'copilot' },
    customRules: ['No console.log in production code'],
  },
});

console.log(response.findings); // ReviewFinding[]
```

## API

### `AIGatewayClient`

```ts
new AIGatewayClient(config: GatewayConfig)
```

Wraps the OpenAI-compatible gateway. Constructed once per request context.

| Method | Returns | Description |
|---|---|---|
| `reviewDiff(request)` | `Promise<GatewayReviewResponse>` | Posts the diff to the gateway and returns parsed findings |

### `reviewDiffWithOpenAICompatibleGateway(config, request)`

Lower-level function used internally by `AIGatewayClient`. Exported for direct use when class instantiation is unnecessary.

### Behavior details

- Diffs longer than 120,000 characters are truncated with a notice appended to the prompt.
- Requests time out after 120 seconds; an `AbortError` is surfaced as a descriptive `Error`.
- When `context.agent.isAgentAuthored` is `true`, the prompt includes agent-specific bloat-detection and artifact-cleanup rules.
- Raw model output is coerced and validated before returning; malformed findings are dropped silently.
- The `_test` export exposes internal helpers (`coerceFinding`, `truncateDiff`, `buildPrompt`, `normalizeSeverity`, `normalizeBaseUrl`) for unit testing.

## Testing

```bash
# From the repo root
pnpm --filter @code-reviewer/ai-gateway-client test

# Or from this directory
node --test --import tsx src/**/*.test.ts
```
