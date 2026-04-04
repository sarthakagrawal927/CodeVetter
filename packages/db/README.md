<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/db

Database access layer for the CodeVetter control plane — schema constants, typed query builders, an in-memory implementation for tests, and a Cloudflare D1 implementation for production.

Part of the [CodeVetter](../../README.md) monorepo.

## Usage

```ts
import { D1ControlPlaneDatabase, TABLES, controlPlaneQueries } from '@code-reviewer/db';

// Production: pass a D1Database binding from a Cloudflare Worker
const db = new D1ControlPlaneDatabase(env.DB);

// Create or look up a user
const user = await db.upsertGithubUser({
  githubUserId: '1234567',
  githubLogin: 'octocat',
  displayName: 'The Octocat',
});

// Query helpers for raw SQL use cases
const query = controlPlaneQueries.listWorkspacesForUser(user.id);
// { text: 'SELECT w.* FROM workspaces w JOIN ...', values: ['usr_...'] }
```

### In-memory database (tests)

```ts
import { InMemoryControlPlaneDatabase } from '@code-reviewer/db';

const db = new InMemoryControlPlaneDatabase();
// Full ControlPlaneDatabase interface, no external dependencies
```

## API

### `TABLES`

Constant map of logical entity names to SQL table name strings. Use instead of raw string literals to avoid typos.

```ts
TABLES.workspaces      // 'workspaces'
TABLES.reviewRuns      // 'review_runs'
TABLES.reviewFindings  // 'review_findings'
// ... and 15 more
```

### `ControlPlaneDatabase` (interface)

Defines every data-access method. Implementations: `InMemoryControlPlaneDatabase` and `D1ControlPlaneDatabase`.

Key method groups:

| Group | Representative methods |
|---|---|
| Users / sessions | `upsertGithubUser`, `createSession`, `getSessionByTokenHash`, `revokeSession` |
| Workspaces | `createWorkspace`, `getWorkspaceBySlug`, `listWorkspacesForUser` |
| Members / invites | `addWorkspaceMember`, `createWorkspaceInvite`, `acceptWorkspaceInvite` |
| GitHub installations | `upsertGitHubInstallation`, `getInstallationByInstallationId` |
| Repositories | `upsertRepository`, `getRepositoryById`, `listRepositoriesByWorkspace` |
| Pull requests | `upsertPullRequest`, `getPullRequestByNumber` |
| Review runs | `createReviewRun`, `updateReviewRun`, `getReviewRunById` |
| Review findings | `createReviewFindings`, `listFindingsByReviewRun` |
| Indexing | `createIndexingRun`, `updateIndexingRun`, `upsertSemanticIndex` |
| Audit / secrets | `createAuditLog`, `upsertWorkspaceSecret`, `getWorkspaceSecret` |

### `D1ControlPlaneDatabase`

```ts
new D1ControlPlaneDatabase(db: D1Database)
```

Production implementation backed by a Cloudflare D1 binding. Maps all `ControlPlaneDatabase` methods to parameterised SQL.

### `InMemoryControlPlaneDatabase`

```ts
new InMemoryControlPlaneDatabase()
```

In-process implementation for unit and integration tests. No network or file-system access required.

### `controlPlaneQueries`

Pre-built `SqlQuery` objects for common read paths. Useful when bypassing the `ControlPlaneDatabase` abstraction to run queries directly against D1 or another SQL client.

| Query | Description |
|---|---|
| `listWorkspacesForUser(userId)` | Active workspaces for a user |
| `getWorkspaceBySlug(slug)` | Single workspace lookup |
| `listRepositoriesByWorkspace(workspaceId)` | Repos ordered by full name |
| `listPullRequestsByRepository(repositoryId)` | PRs ordered by number desc |
| `listReviewRunsByPullRequest(pullRequestId)` | Runs ordered by started_at desc |
| `listAuditLogsByWorkspace(workspaceId, limit?)` | Audit log, most recent first |

### `CONTROL_PLANE_MIGRATIONS`

Array of `MigrationDefinition` objects (`{ id, path }`) listing the ordered SQL migration files.

## Testing

```bash
# From the repo root
pnpm --filter @code-reviewer/db test

# Or from this directory
node --test --import tsx src/**/*.test.ts
```
