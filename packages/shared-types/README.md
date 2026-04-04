<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/shared-types

TypeScript type definitions and constants shared across all packages and apps in the CodeVetter monorepo. Zero runtime dependencies.

Part of the [CodeVetter](../../README.md) monorepo.

## Usage

```ts
import type {
  ReviewFinding,
  ReviewSeverity,
  GatewayConfig,
  GatewayReviewRequest,
  WorkspaceRecord,
  ReviewRunRecord,
} from '@code-reviewer/shared-types';

import { REVIEW_SEVERITIES } from '@code-reviewer/shared-types';
// ['low', 'medium', 'high', 'critical']
```

## API

All exports are TypeScript types or `const` values — no functions, no side effects.

### `review.ts` — Core review types

| Export | Kind | Description |
|---|---|---|
| `REVIEW_SEVERITIES` | `const` | Tuple `['low', 'medium', 'high', 'critical']` used for validation |
| `ReviewSeverity` | type | `'low' \| 'medium' \| 'high' \| 'critical'` |
| `ReviewFinding` | type | A single AI-generated finding: `severity`, `title`, `summary`, optional `suggestion`, `filePath`, `line`, `confidence` |
| `InlineReviewComment` | type | A GitHub inline PR comment: `path`, `line`, `side`, `body` |
| `ReviewScore` | type | Computed score with `quality`, `risk`, `value`, and `composite` fields |
| `ReviewResult` | type | Aggregate result: `findings`, `score`, `summaryMarkdown`, `inlineComments` |

### `gateway.ts` — AI gateway request/response types

| Export | Kind | Description |
|---|---|---|
| `GatewayConfig` | type | Gateway connection config: `baseUrl`, `apiKey`, `model`, `reviewTone` |
| `GatewayReviewFile` | type | A single changed file: `path`, optional `patch`, `status`, `additions`, `deletions`, `changes` |
| `AgentContext` | type | Agent authorship metadata: `isAgentAuthored`, optional `agentName` |
| `GatewayReviewRequest` | type | Full review request: `diff`, `files[]`, optional `context` (repo, PR, tone, agent, custom rules) |
| `GatewayReviewResponse` | type | Gateway response: `findings[]`, `rawResponse` |

### `v1.ts` — Platform record types

Types covering the full data model persisted in the control-plane database.

**Enumerations / union types**

| Export | Values |
|---|---|
| `ProviderType` | `'github'` |
| `PolicySeverity` | `'low' \| 'medium' \| 'high' \| 'critical'` |
| `ReviewTone` | `'strict' \| 'balanced' \| 'friendly'` |
| `WorkspaceKind` | `'organization' \| 'personal' \| 'oss_free'` |
| `WorkspaceTier` | `'free' \| 'paid'` |
| `WorkspaceRole` | `'owner' \| 'admin' \| 'member' \| 'viewer'` |
| `ReviewRunStatus` | `'queued' \| 'running' \| 'completed' \| 'failed'` |
| `ReviewMode` | `'standard' \| 'agent'` |
| `ReviewAction` | `'COMMENT' \| 'APPROVE' \| 'REQUEST_CHANGES'` |
| `PullRequestState` | `'open' \| 'closed' \| 'merged'` |
| `IndexedCodeLanguage` | 16 language values (typescript, python, go, ...) |
| `IndexedSymbolKind` | `'module' \| 'class' \| 'interface' \| 'type' \| 'enum' \| 'function' \| 'method' \| 'const' \| 'block'` |

**Record types** (database rows)

`UserRecord`, `SessionRecord`, `WorkspaceRecord`, `WorkspaceMemberRecord`, `WorkspaceInviteRecord`, `GitHubInstallationRecord`, `RepositoryConnection`, `PullRequestRecord`, `ReviewRunRecord`, `ReviewFindingRecord`, `IndexingJobRecord`, `IndexedFileRecord`, `SemanticChunkRecord`, `AuditLogRecord`, `WorkspaceSecretRecord`, `OrganizationRecord`, `OrganizationMemberRecord`, `RepositoryUsageRecord`

**Policy / rules types**

`RepositoryRuleConfig`, `WorkspaceRuleDefaults`, `RepositoryRuleOverride`, `RuleSeverityThresholds`

**Auth types**

`OAuthStatePayload`, `AuthSessionUser`, `AuthSessionWorkspace`, `AuthSessionResponse`

**Request/payload types**

`CreateWorkspaceRequest`, `CreateInviteRequest`, `UpdateWorkspaceMemberRequest`, `CreateActionReviewTriggerRequest`, `ReviewTriggerPayload`, `ReviewJob`, `IndexingJob`, `WorkerJob`

**Semantic indexing types**

`SemanticIndexBatch`, `IndexingChunkStrategy`, `DriftSignal`, `DriftCheckInput`, `DriftCheckRecord`, `ReconcileRunRecord`

**Webhook types**

`GitHubWebhookEnvelope`, `WebhookEventProcessingStatus`

## Testing

This package exports types only. There are no runtime behaviours to test directly. Build validation:

```bash
# From the repo root
pnpm --filter @code-reviewer/shared-types build

# Or from this directory
tsc -p tsconfig.json
```
