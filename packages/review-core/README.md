<!-- generated-by: gsd-doc-writer -->
# @code-reviewer/review-core

Pure business logic for CodeVetter's review pipeline — scoring, prompt building, GitHub API helpers, language detection, and semantic duplicate analysis.

Part of the [CodeVetter](../../README.md) monorepo.

## Usage

```ts
import {
  computeScore,
  determineReviewAction,
  buildOverallBody,
  getPrDiff,
  detectLanguage,
} from '@code-reviewer/review-core';

// Score findings and decide a GitHub review action
const score = computeScore(findings);          // 0–100, 100 = no issues
const action = determineReviewAction(findings, score, 'agent');

// Build the PR comment body
const body = buildOverallBody(findings, score, reviewRunId, action);

// GitHub API
const diff = await getPrDiff({ appId, privateKey }, owner, repo, prNumber, installationId);

// Language detection
const lang = detectLanguage('src/api/handler.py'); // 'python'
```

## API

### Scoring — `scoring.ts`

| Export | Description |
|---|---|
| `computeScore(findings)` | Returns a composite score 0–100 (100 = clean). Penalises by severity: critical −20, high −10, medium −5, low −2 |
| `computeFindingFingerprint(finding)` | Stable hash of `filePath + severity + title` — used for dedup across re-reviews |
| `determineReviewAction(findings, score, reviewMode)` | Returns `'APPROVE'`, `'COMMENT'`, or `'REQUEST_CHANGES'`. Agent PRs are blocked on any high/critical finding or score < 80; human PRs default to `'COMMENT'` |

### Formatting — `formatting.ts`

| Export | Description |
|---|---|
| `buildOverallBody(findings, score, reviewRunId, action, resolvedFindings?, tier?)` | Renders the full GitHub PR comment body as Markdown with score badge, findings table, and an embedded structured-data block |

### Prompt helpers — `prompt.ts`

| Export | Description |
|---|---|
| `truncateDiff(diff)` | Clips diffs longer than 120,000 characters and appends a truncation notice |
| `coerceFinding(raw)` | Validates and normalises a raw AI response object into a typed `ReviewFinding`; returns `null` on failure |
| `buildPrompt(request, truncated)` | Assembles the full system + user prompt sent to the AI gateway |
| `parseReviewResponse(raw)` | Parses the AI gateway JSON response and returns an array of coerced findings |

### GitHub API — `github.ts`

| Export | Description |
|---|---|
| `getPrDiff(config, owner, repo, prNumber, installationId)` | Fetches the unified diff for a PR using a GitHub App JWT |
| `getPrDiffWithPat(pat, owner, repo, prNumber)` | Fetches the unified diff using a personal access token |
| `getPrFiles(config, owner, repo, prNumber, installationId)` | Lists changed files with metadata |
| `getPrFilesWithPat(pat, owner, repo, prNumber)` | Lists changed files using a PAT |
| `getInstallationToken(config, installationId)` | Exchanges a GitHub App JWT for a short-lived installation token |
| `getRepoTree(token, owner, repo, treeSha)` | Returns the recursive file tree for a given tree SHA |
| `getFileContent(token, owner, repo, path, ref?)` | Fetches raw file content at a ref |
| `postPrReview(token, owner, repo, prNumber, event, body, comments?)` | Submits a GitHub PR review with optional inline comments |
| `postPrComment(token, owner, repo, prNumber, body)` | Posts a general PR comment |

Types: `GitHubAppConfig`, `GitHubPrFile`, `ReviewComment`, `ReviewEvent`, `GitHubTreeEntry`

### Language detection — `language.ts`

| Export | Description |
|---|---|
| `detectLanguage(path)` | Maps a file path's extension to an `IndexedCodeLanguage` value; falls back to `'other'` |
| `hasIndexableExtension(path)` | Returns `true` if the file extension is in the supported indexing set |

Supported extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.java`, `.cs`, `.rb`, `.php`, `.rs`, `.kt`, `.swift`, `.sql`, `.yaml`, `.yml`, `.json`, `.md`

### Semantic analysis — `semantic.ts`

| Export | Description |
|---|---|
| `extractSymbols(code, filePath)` | Extracts function/class/type/const definitions from source using regex patterns |
| `findDuplicates(newSymbols, existingSymbols)` | Finds exact or fuzzy (Jaccard token similarity) duplicate symbols |
| `extractAddedCode(diff)` | Pulls only the added lines (`+` prefix) from a unified diff |
| `analyzeDiffForDuplicates(diff, filePath, existingSymbols)` | Full pipeline: extract added code → extract symbols → find duplicates → return `ReviewFinding[]` |

Types: `CodeSymbol`, `DuplicateMatch`

## Testing

This package has no `test` script configured. Tests can be added using Node's built-in test runner:

```bash
node --test --import tsx src/**/*.test.ts
```
