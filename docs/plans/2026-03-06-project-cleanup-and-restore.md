# Project Cleanup, Indexing Restore & Test Coverage

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the v0-to-v1 migration cleanup, restore tree-sitter indexing via WASM (CF Workers compatible), replace hardcoded dashboard stats, and add test coverage for AI gateway client + DB control plane.

**Architecture:** The review worker migrated from Node.js (`tsc`/`node`) to Cloudflare Workers (`wrangler`). Native tree-sitter C++ bindings are replaced with `web-tree-sitter` (pure WASM). Tests use Node's built-in test runner (no extra deps). Dashboard hardcoded stats become dash placeholders until real API data exists.

**Tech Stack:** TypeScript, Cloudflare Workers, web-tree-sitter (WASM), Hono, CockroachDB/pg, Node test runner

---

## Task 1: Commit v0 Cleanup

All deleted files are verified as unused by current codebase. The unstaged changes are a coherent v0-to-v1 migration.

**Files:**
- Delete: `action.yml`, `dist/index.js`, `src/github.ts`, `src/main.ts`
- Delete: `packages/review-core/` (entire directory)
- Delete: `workers/api/src/http.ts`, `workers/api/src/router.ts`, `workers/api/src/store.ts`
- Delete: `docs/v0-lite.md`, `docs/v1-indexing-spec.md`, `docs/v1-roadmap.md`, `docs/v1-technical-questions.md`
- Delete: `workers/review/src/tree-sitter-languages.d.ts`, `workers/review/src/indexing.ts`
- Modified (already unstaged): `workers/api/src/index.ts`, `workers/api/wrangler.toml`, `workers/review/package.json`, `workers/review/tsconfig.json`, `workers/review/src/index.ts`, `workers/review/src/queue.ts`, `workers/review/src/github.ts`, `apps/dashboard/package.json`, `apps/dashboard/app/login/page.tsx`, `apps/dashboard/app/globals.css`, `apps/dashboard/.gitignore`, `package.json`, `package-lock.json`

**Step 1: Stage all current unstaged changes**

```bash
git add action.yml dist/ src/ packages/review-core/ \
  workers/api/src/http.ts workers/api/src/router.ts workers/api/src/store.ts \
  docs/v0-lite.md docs/v1-indexing-spec.md docs/v1-roadmap.md docs/v1-technical-questions.md \
  workers/review/src/tree-sitter-languages.d.ts workers/review/src/indexing.ts \
  workers/api/src/index.ts workers/api/wrangler.toml \
  workers/review/package.json workers/review/tsconfig.json \
  workers/review/src/index.ts workers/review/src/queue.ts workers/review/src/github.ts \
  apps/dashboard/package.json apps/dashboard/app/login/page.tsx \
  apps/dashboard/app/globals.css apps/dashboard/.gitignore \
  package.json package-lock.json README.md .claude/settings.local.json
```

**Step 2: Commit**

```bash
git commit -m "chore: v0-to-v1 migration cleanup

Remove GitHub Action entry point, review-core package, old API worker
files (router/store/http), and legacy docs. Migrate review worker from
Node.js (tsc/node) to Cloudflare Workers (wrangler). Remove native
tree-sitter deps (incompatible with CF Workers V8 isolate).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 3: Verify**

```bash
git status
git log --oneline -1
```

Expected: clean working tree (except untracked files like `.env.local`, `.playwright-mcp/`, `wrangler.toml`).

---

## Task 2: Update README

Remove GitHub Action references and broken doc links. Reflect current architecture.

**Files:**
- Modify: `README.md`

**Step 1: Update README**

Remove these sections entirely:
- "GitHub Action Quickstart (v1)" section (lines ~19-39)
- "Action Inputs" table (lines ~41-49)
- "Deprecated legacy v0 gateway inputs" line

Update "Monorepo Layout" to remove `action.yml`, `src/`, `dist/`, and `docs/` entries.

Update "Roadmap Docs" section — remove references to deleted docs (`v0-lite.md`, `v1-roadmap.md`, `v1-technical-questions.md`, `v1-indexing-spec.md`). Keep `docs/v2-roadmap.md` reference if it exists.

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for v1 architecture, remove Action references

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Replace Dashboard Hardcoded Stats

The homepage shows fake numbers ("128 Active Workspaces", "2.4k Review Runs", "412 Policy Blocks"). Replace with dash placeholders matching the pattern used by the indexed-code page.

**Files:**
- Modify: `apps/dashboard/app/page.tsx`

**Step 1: Replace the `coreSignals` array values with dashes**

Change:
```typescript
const coreSignals = [
  { label: 'Active Workspaces', value: '128' },
  { label: 'Review Runs', value: '2.4k' },
  { label: 'Policy Blocks', value: '412' }
];
```

To:
```typescript
const coreSignals = [
  { label: 'Active Workspaces', value: '\u2014' },
  { label: 'Review Runs', value: '\u2014' },
  { label: 'Policy Blocks', value: '\u2014' }
];
```

**Step 2: Commit**

```bash
git add apps/dashboard/app/page.tsx
git commit -m "fix(dashboard): replace hardcoded stats with placeholder dashes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Restore Indexing with web-tree-sitter (WASM)

Replace the deleted native tree-sitter indexing with `web-tree-sitter` which runs in CF Workers' V8 isolate. The module must produce the same `IndexedFileRecord` and `SemanticChunkRecord` output types.

**Files:**
- Create: `workers/review/src/indexing.ts`
- Modify: `workers/review/package.json` (add `web-tree-sitter` dep)
- Modify: `workers/review/src/handlers.ts` (wire real indexing into handler)

**Step 1: Install web-tree-sitter**

```bash
cd /Users/sarthakagrawal/Desktop/code-reviewer
npm install -w workers/review web-tree-sitter@^0.24.0
```

Note: `web-tree-sitter` ships its own `.wasm` file. For CF Workers, the WASM binary is loaded via `fetch()` or bundled by wrangler. The language `.wasm` files (tree-sitter-javascript.wasm, tree-sitter-typescript.wasm, tree-sitter-python.wasm) need to be downloaded from the tree-sitter releases and placed in `workers/review/src/grammars/`.

**Step 2: Download WASM grammar files**

```bash
mkdir -p workers/review/src/grammars
# Download pre-built WASM grammars from tree-sitter releases
# These are the same languages the old native module supported
curl -L -o workers/review/src/grammars/tree-sitter-javascript.wasm \
  "https://github.com/nicolo-ribaudo/nicolo-ribaudo-tree-sitter-wasm-prebuilt/raw/main/out/tree-sitter-javascript.wasm"
curl -L -o workers/review/src/grammars/tree-sitter-typescript.wasm \
  "https://github.com/nicolo-ribaudo/nicolo-ribaudo-tree-sitter-wasm-prebuilt/raw/main/out/tree-sitter-typescript.wasm"
curl -L -o workers/review/src/grammars/tree-sitter-python.wasm \
  "https://github.com/nicolo-ribaudo/nicolo-ribaudo-tree-sitter-wasm-prebuilt/raw/main/out/tree-sitter-python.wasm"
```

If these URLs are unavailable, use `npm install tree-sitter-wasms` as an alternative source, or build from source with `tree-sitter build --wasm`.

**Step 3: Create `workers/review/src/indexing.ts`**

This is a port of the deleted module from native tree-sitter to web-tree-sitter. Key differences:
- Uses `import Parser from 'web-tree-sitter'` instead of native `tree-sitter`
- `Parser.init()` must be called once (async)
- Languages are loaded via `Parser.Language.load(wasmBuffer)` instead of direct import
- All tree-sitter API calls remain the same after init

The module must export:
```typescript
export type SourceFileForIndexing = {
  repositoryId: string;
  sourceRef: string;
  path: string;
  blobSha: string;
  content: string;
};

export type TreeSitterChunkingConfig = {
  maxFileBytes: number;
  maxChunkLines: number;
};

export function detectLanguage(path: string): IndexedCodeLanguage;

export async function chunkFileWithTreeSitter(
  file: SourceFileForIndexing,
  config: TreeSitterChunkingConfig
): Promise<{ fileRecord: IndexedFileRecord; chunks: SemanticChunkRecord[] }>;
```

Key implementation details:
- Use `crypto.subtle.digest('SHA-256', ...)` instead of `crypto.createHash` (Web Crypto API, available in CF Workers)
- Language detection: same extension mapping as before (`.ts` -> typescript, `.tsx` -> tsx, `.js` -> javascript, `.jsx` -> jsx, `.py` -> python)
- Node types by language: same as before (function_declaration, class_declaration, etc.)
- Symbol kind extraction: same mapping from AST node types to IndexedSymbolKind
- Chunk splitting: same logic (split chunks > maxChunkLines, min 20 lines)
- Deduplication: same (skip identical content SHA)
- Lazy parser initialization: init once, cache language objects

**Step 4: Wire indexing into handlers.ts**

Replace the stub `handleIndexingJob` with real implementation that:
1. Gets the repository from DB
2. Gets installation token
3. Fetches file tree from GitHub (use `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`)
4. Fetches file contents for supported languages (respecting `maxIndexFileBytes`)
5. Calls `chunkFileWithTreeSitter` for each file
6. Stores results in DB (via `db.createIndexingRun` update)
7. Updates indexing run status to completed/failed

Note: The DB doesn't currently have methods to store `IndexedFileRecord` or `SemanticChunkRecord`. For this task, just update the indexing run status with a summary of what was indexed (file count, chunk count) in the `summary` JSON field. Full DB storage of chunks is a future task.

**Step 5: Commit**

```bash
git add workers/review/src/indexing.ts workers/review/src/grammars/ \
  workers/review/package.json workers/review/src/handlers.ts \
  package-lock.json
git commit -m "feat: restore indexing with web-tree-sitter WASM

Port native tree-sitter indexing to web-tree-sitter for CF Workers
compatibility. Supports JS/TS/TSX/Python. Uses Web Crypto API for
hashing. Stores indexing summary in run record.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Add Tests — AI Gateway Client

Test the critical parsing/coercion logic in `packages/ai-gateway-client/src/openaiCompatible.ts`. Use Node's built-in test runner (`node --test`).

**Files:**
- Create: `packages/ai-gateway-client/src/openaiCompatible.test.ts`
- Modify: `packages/ai-gateway-client/package.json` (add test script)

**Step 1: Add test script to package.json**

Read current `packages/ai-gateway-client/package.json`, add:
```json
"scripts": {
  "test": "node --test --experimental-strip-types src/**/*.test.ts"
}
```

Note: `--experimental-strip-types` lets Node run `.ts` files directly (Node 22+). If not available, use `tsx` or compile first. Check `node --version` and adjust.

**Step 2: Write tests**

Test these functions (they're not exported, so test via the public interface or extract them):

Since `coerceFinding`, `truncateDiff`, `buildPrompt`, `normalizeSeverity` are internal, the cleanest approach is to test `reviewDiffWithOpenAICompatibleGateway` by mocking `fetch`. But that's heavy. Instead, export the pure functions for testing:

Add to bottom of `openaiCompatible.ts`:
```typescript
// Exported for testing only
export const _test = { coerceFinding, truncateDiff, buildPrompt, normalizeSeverity, normalizeBaseUrl };
```

Tests to write:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from './openaiCompatible';

const { coerceFinding, truncateDiff, buildPrompt, normalizeSeverity, normalizeBaseUrl } = _test;

describe('normalizeBaseUrl', () => {
  it('accepts valid https URL', () => {
    assert.equal(normalizeBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
  });
  it('throws on empty string', () => {
    assert.throws(() => normalizeBaseUrl(''), /required/);
  });
  it('throws on invalid protocol', () => {
    assert.throws(() => normalizeBaseUrl('ftp://example.com'), /protocol/);
  });
  it('strips trailing slash', () => {
    const result = normalizeBaseUrl('https://api.example.com/');
    assert.ok(!result.endsWith('/'));
  });
});

describe('normalizeSeverity', () => {
  it('accepts valid severities', () => {
    for (const s of ['low', 'medium', 'high', 'critical']) {
      assert.equal(normalizeSeverity(s), s);
    }
  });
  it('is case insensitive', () => {
    assert.equal(normalizeSeverity('HIGH'), 'high');
  });
  it('returns null for invalid', () => {
    assert.equal(normalizeSeverity('extreme'), null);
    assert.equal(normalizeSeverity(42), null);
    assert.equal(normalizeSeverity(null), null);
  });
});

describe('truncateDiff', () => {
  it('returns unchanged for short diffs', () => {
    const result = truncateDiff('short diff');
    assert.deepEqual(result, { text: 'short diff', truncated: false });
  });
  it('truncates long diffs', () => {
    const long = 'x'.repeat(200000);
    const result = truncateDiff(long);
    assert.equal(result.truncated, true);
    assert.ok(result.text.length < long.length);
    assert.ok(result.text.includes('[diff truncated'));
  });
});

describe('coerceFinding', () => {
  it('coerces valid finding', () => {
    const result = coerceFinding({
      severity: 'high',
      title: 'SQL injection risk',
      summary: 'User input passed directly to query',
      filePath: 'src/db.ts',
      line: 42,
      confidence: 0.9,
    });
    assert.ok(result);
    assert.equal(result.severity, 'high');
    assert.equal(result.title, 'SQL injection risk');
    assert.equal(result.line, 42);
    assert.equal(result.confidence, 0.9);
  });

  it('returns null for missing severity', () => {
    assert.equal(coerceFinding({ title: 'x', summary: 'y' }), null);
  });

  it('returns null for missing title', () => {
    assert.equal(coerceFinding({ severity: 'low', summary: 'y' }), null);
  });

  it('returns null for non-object', () => {
    assert.equal(coerceFinding(null), null);
    assert.equal(coerceFinding('string'), null);
  });

  it('clamps confidence to 0-1', () => {
    const result = coerceFinding({
      severity: 'low', title: 'test', summary: 'test', confidence: 5.0,
    });
    assert.ok(result);
    assert.equal(result.confidence, 1);
  });

  it('truncates long titles', () => {
    const result = coerceFinding({
      severity: 'low',
      title: 'A'.repeat(200),
      summary: 'test summary here',
    });
    assert.ok(result);
    assert.ok(result.title.length <= 83); // 80 + "..."
  });

  it('accepts file as alias for filePath', () => {
    const result = coerceFinding({
      severity: 'low', title: 'test', summary: 'test', file: 'src/foo.ts',
    });
    assert.ok(result);
    assert.equal(result.filePath, 'src/foo.ts');
  });
});

describe('buildPrompt', () => {
  it('includes diff and file list', () => {
    const prompt = buildPrompt(
      {
        diff: '+ added line',
        files: [{ path: 'src/foo.ts', status: 'modified' }],
        context: { repoFullName: 'org/repo', prNumber: 42 },
      },
      false,
    );
    assert.ok(prompt.includes('+ added line'));
    assert.ok(prompt.includes('src/foo.ts'));
    assert.ok(prompt.includes('org/repo'));
    assert.ok(prompt.includes('42'));
  });

  it('notes truncation', () => {
    const prompt = buildPrompt(
      { diff: 'diff', files: [], context: {} },
      true,
    );
    assert.ok(prompt.includes('truncated'));
  });
});
```

**Step 3: Run tests**

```bash
cd /Users/sarthakagrawal/Desktop/code-reviewer
npm test -w packages/ai-gateway-client
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add packages/ai-gateway-client/src/openaiCompatible.ts \
  packages/ai-gateway-client/src/openaiCompatible.test.ts \
  packages/ai-gateway-client/package.json
git commit -m "test: add AI gateway client unit tests

Cover normalizeBaseUrl, normalizeSeverity, truncateDiff, coerceFinding,
and buildPrompt. Uses Node built-in test runner.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Add Tests — DB Control Plane

Test the in-memory `ControlPlaneDatabase` implementation. This exercises the interface contract that both in-memory and Postgres adapters must satisfy.

**Files:**
- Create: `packages/db/src/controlPlane.test.ts`
- Modify: `packages/db/package.json` (add test script)

**Step 1: Add test script**

```json
"scripts": {
  "test": "node --test --experimental-strip-types src/**/*.test.ts"
}
```

**Step 2: Write tests**

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryControlPlaneDatabase } from './controlPlane';
import type { ControlPlaneDatabase } from './controlPlane';

let db: ControlPlaneDatabase;

beforeEach(() => {
  db = new InMemoryControlPlaneDatabase();
});

describe('users', () => {
  it('upserts and retrieves a user by github ID', async () => {
    const user = await db.upsertUserFromGithub({
      githubUserId: 'gh_1',
      githubLogin: 'testuser',
      displayName: 'Test User',
    });
    assert.equal(user.githubLogin, 'testuser');
    const found = await db.getUserByGithubId('gh_1');
    assert.ok(found);
    assert.equal(found.id, user.id);
  });

  it('updates existing user on re-upsert', async () => {
    const first = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'old' });
    const second = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'new' });
    assert.equal(first.id, second.id);
    assert.equal(second.githubLogin, 'new');
  });

  it('returns undefined for unknown user', async () => {
    assert.equal(await db.getUserById('nonexistent'), undefined);
  });
});

describe('sessions', () => {
  it('creates and retrieves by token hash', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const session = await db.createSession({
      userId: user.id,
      sessionTokenHash: 'hash123',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const found = await db.getSessionByTokenHash('hash123');
    assert.ok(found);
    assert.equal(found.id, session.id);
  });

  it('revokes a session', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const session = await db.createSession({
      userId: user.id,
      sessionTokenHash: 'hash456',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const revoked = await db.revokeSession(session.id);
    assert.ok(revoked);
    assert.ok(revoked.revokedAt);
  });
});

describe('workspaces', () => {
  it('creates workspace and adds member', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const ws = await db.createWorkspace({
      slug: 'test-ws',
      name: 'Test Workspace',
      kind: 'organization',
      createdByUserId: user.id,
    });
    assert.equal(ws.slug, 'test-ws');

    const member = await db.addWorkspaceMember({
      workspaceId: ws.id,
      userId: user.id,
      githubUserId: 'gh_1',
      githubLogin: 'u',
      role: 'owner',
      status: 'active',
    });
    assert.equal(member.role, 'owner');

    const members = await db.listWorkspaceMembers(ws.id);
    assert.equal(members.length, 1);
  });

  it('finds workspace by slug', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    await db.createWorkspace({ slug: 'my-ws', name: 'My WS', kind: 'personal', createdByUserId: user.id });
    const found = await db.getWorkspaceBySlug('my-ws');
    assert.ok(found);
    assert.equal(found.name, 'My WS');
  });
});

describe('repositories', () => {
  it('upserts and lists repositories', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const ws = await db.createWorkspace({ slug: 'ws', name: 'WS', kind: 'organization', createdByUserId: user.id });
    const repo = await db.upsertRepository({
      workspaceId: ws.id,
      provider: 'github',
      owner: 'org',
      name: 'repo',
      fullName: 'org/repo',
      isActive: true,
    });
    assert.equal(repo.fullName, 'org/repo');

    const list = await db.listRepositories(ws.id);
    assert.equal(list.length, 1);
  });
});

describe('review runs', () => {
  it('creates, updates, and lists review runs', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const ws = await db.createWorkspace({ slug: 'ws', name: 'WS', kind: 'organization', createdByUserId: user.id });
    const repo = await db.upsertRepository({
      workspaceId: ws.id, provider: 'github', owner: 'o', name: 'r', fullName: 'o/r', isActive: true,
    });

    const run = await db.createReviewRun({
      repositoryId: repo.id,
      prNumber: 1,
      headSha: 'abc123',
      status: 'queued',
    });
    assert.equal(run.status, 'queued');

    const updated = await db.updateReviewRun(run.id, {
      status: 'completed',
      scoreComposite: 85,
      findingsCount: 3,
    });
    assert.ok(updated);
    assert.equal(updated.status, 'completed');
    assert.equal(updated.scoreComposite, 85);
  });

  it('adds and lists findings', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const ws = await db.createWorkspace({ slug: 'ws', name: 'WS', kind: 'organization', createdByUserId: user.id });
    const repo = await db.upsertRepository({
      workspaceId: ws.id, provider: 'github', owner: 'o', name: 'r', fullName: 'o/r', isActive: true,
    });
    const run = await db.createReviewRun({
      repositoryId: repo.id, prNumber: 1, headSha: 'abc', status: 'running',
    });

    await db.addReviewFinding({
      reviewRunId: run.id,
      severity: 'high',
      title: 'SQL injection',
      summary: 'Unsanitized input',
      filePath: 'src/db.ts',
      line: 42,
    });

    const findings = await db.listReviewFindingsByRun(run.id);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'high');
  });
});

describe('indexing runs', () => {
  it('creates and updates indexing run', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const ws = await db.createWorkspace({ slug: 'ws', name: 'WS', kind: 'organization', createdByUserId: user.id });
    const repo = await db.upsertRepository({
      workspaceId: ws.id, provider: 'github', owner: 'o', name: 'r', fullName: 'o/r', isActive: true,
    });

    const run = await db.createIndexingRun({ repositoryId: repo.id, status: 'queued' });
    assert.equal(run.status, 'queued');

    const updated = await db.updateIndexingRun(run.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    assert.ok(updated);
    assert.equal(updated.status, 'completed');
  });
});

describe('audit logs', () => {
  it('appends and lists audit logs', async () => {
    const user = await db.upsertUserFromGithub({ githubUserId: 'gh_1', githubLogin: 'u' });
    const ws = await db.createWorkspace({ slug: 'ws', name: 'WS', kind: 'organization', createdByUserId: user.id });

    await db.appendAuditLog({
      workspaceId: ws.id,
      actorUserId: user.id,
      action: 'workspace.create',
      resourceType: 'workspace',
      resourceId: ws.id,
      metadata: {},
    });

    const logs = await db.listAuditLogs(ws.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'workspace.create');
  });
});

describe('webhook events', () => {
  it('records and retrieves by delivery ID', async () => {
    const envelope = {
      event: 'pull_request',
      deliveryId: 'del_123',
      payload: { action: 'opened' },
      receivedAt: new Date().toISOString(),
    };
    await db.recordWebhookEvent(envelope);

    const found = await db.getWebhookEventByDeliveryId('github', 'del_123');
    assert.ok(found);
    assert.equal(found.event, 'pull_request');
  });
});
```

**Step 3: Run tests**

```bash
npm test -w packages/db
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add packages/db/src/controlPlane.test.ts packages/db/package.json
git commit -m "test: add DB control plane unit tests

Cover users, sessions, workspaces, repositories, review runs, findings,
indexing runs, audit logs, and webhook events against InMemory adapter.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Verify All Builds

**Step 1: Build shared packages**

```bash
npm run build:packages
```

Expected: all three packages build (shared-types, db, ai-gateway-client).

**Step 2: Build API worker**

```bash
cd workers/api && npx wrangler deploy --dry-run --outdir=.vercel-dry 2>&1; cd ../..
```

Or if wrangler isn't configured for dry-run, just check TypeScript:
```bash
cd workers/api && npx tsc --noEmit; cd ../..
```

**Step 3: Build review worker**

```bash
cd workers/review && npx tsc --noEmit; cd ../..
```

**Step 4: Build dashboard**

```bash
npm run -w apps/dashboard build
```

**Step 5: Run all tests**

```bash
npm test -w packages/ai-gateway-client && npm test -w packages/db
```

**Step 6: Final commit if any fixes needed**

If builds reveal issues, fix and commit with descriptive message.

---

## Task Order & Dependencies

```
Task 1 (commit cleanup) ──> Task 2 (README) ──> Task 3 (dashboard stats)
                                                         │
Task 4 (restore indexing) ─────────────────────────────> │
                                                         │
Task 5 (gateway tests) ───────────────────────────────> │
Task 6 (DB tests) ────────────────────────────────────> │
                                                         v
                                                  Task 7 (verify all)
```

Tasks 2, 3, 4, 5, 6 can run in parallel after Task 1. Task 7 runs last.
