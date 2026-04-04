# Free PR Review for Open Source — Strategy Document

**Date**: 2026-04-04
**Status**: Proposed
**Previous plans**: `plans/competitive-landscape-2026-03-22.md`, `plans/2026-03-28-roadmap-all-phases-complete.md`

---

## Thesis

Give every public repo free automated PR reviews. Every review comment is a public ad for CodeVetter. OSS maintainers get value immediately; CodeVetter gets distribution, SEO, and a pipeline to paid conversions on private repos.

This is how CodeRabbit got to 2M+ connected repos. Sourcery already gates their free tier to public repos only ($0 public, $12/user/month private). The playbook is proven. CodeVetter's edge: agent-aware reviews that no free competitor offers.

---

## 1. Free Tier for Public Repos

### What the user gets
- Install the CodeVetter GitHub App on any **public** repository
- Every PR opened or pushed to gets an automated review (same pipeline as paid)
- Agent detection included (`workers/api/src/agentDetection.ts` — bot accounts, PR body markers, branch prefixes, co-author patterns)
- Review includes: severity-ranked findings, inline comments with file/line anchors, composite score, suggested fixes for agent PRs
- Same review-core logic: `buildPrompt()`, `computeScore()`, `determineReviewAction()`, `buildOverallBody()` from `packages/review-core/src/`

### What changes vs. paid
- Rate-limited (see section 4)
- No custom review rules (paid only — `workspace_rule_defaults` and `repository_rule_overrides` tables stay locked)
- No custom review tone (defaults to `balanced`; paid users can set `strict` or `friendly` per `ReviewTone` type in `packages/shared-types/src/v1.ts`)
- No workspace dashboard or team management
- No Slack/webhook integrations
- "Reviewed by CodeVetter" badge on every comment (cannot be removed)

### Why this works
- The review worker (`workers/review/src/handlers.ts`) already runs the full pipeline: fetch diff via GitHub App token, call AI gateway, post PR review via `postPrReview()`. No new review logic needed for free tier — just gating.
- Public repos are readable by the GitHub App installation token, so no additional auth flow is required.
- The `repositories.is_private` column already exists in the schema (`packages/db/migrations/0001_init.sql`, line 104). This is the tier gate.

---

## 2. "Reviewed by CodeVetter" Badge

### Implementation
Every review comment posted via `postPrReview()` in `workers/review/src/github.ts` includes an `overallBody` string built by `buildOverallBody()` in `packages/review-core/src/formatting.ts`. Currently it ends with:

```
*Automated review by CodeVetter*
```

Change this to include a badge and link for free-tier repos:

```markdown
[![Reviewed by CodeVetter](https://codevetter.com/badge/reviewed.svg)](https://codevetter.com/reviews/{owner}/{repo}/pr/{prNumber})

**Score:** 87/100 | **Findings:** 1 medium, 2 low
*Free automated review for open source — [get CodeVetter for your repo](https://codevetter.com/install)*
```

### Badge variants
- `reviewed.svg` — default green shield
- `reviewed-score-{N}.svg` — score-colored (green 80+, yellow 60-79, red <60)
- `reviewed-agent.svg` — distinct badge for agent-authored PRs (differentiator)

### Where it appears
1. **PR review body** — the main review comment posted via GitHub API
2. **Inline comments** — each finding comment gets a small footer: `— [CodeVetter](https://codevetter.com)`
3. **README badge** — provide an embeddable badge for repos: `![CodeVetter](https://codevetter.com/badge/{owner}/{repo}.svg)` showing last review score

### Paid tier difference
Paid users get the review without the marketing footer. The `*Free automated review for open source*` line and the install CTA are stripped. The badge link still works (points to the dashboard instead of the public page).

### Files to modify
- `packages/review-core/src/formatting.ts` — `buildOverallBody()` accepts a new `tier: 'free' | 'paid'` param
- `workers/review/src/handlers.ts` — `handleReviewJob()` passes tier based on `repository.isPrivate`
- New: `apps/landing-page/` — badge SVG generation endpoint (or static SVGs in `/public`)

---

## 3. GitHub App Changes

### Current state
The GitHub App already handles the full PR review lifecycle:
- **Webhook receiver**: `workers/api/src/index.ts` line 1990 — `POST /v1/webhooks/github`
- **Event handling**: `pull_request` events with `opened`, `reopened`, `synchronize` actions trigger reviews (line 2100: `actionCanTriggerReview()`)
- **@codevetter mentions**: `issue_comment` events with `@codevetter` in body trigger on-demand reviews (line 2140)
- **Review posting**: `workers/review/src/github.ts` — `postPrReview()` posts the review, `postPrComment()` for standalone comments
- **Installation sync**: `POST /v1/workspaces/:id/github/sync` syncs repos from GitHub installation (API worker line ~1350)

### What needs to change

#### 3a. Installation flow (new: no-auth free path)
Currently, installing the GitHub App requires:
1. GitHub OAuth login → user record in `users` table
2. Workspace creation → `workspaces` table
3. GitHub App installation linked to workspace → `github_installations` table
4. Repository sync → `repositories` table

For free/public tier, add a **lightweight path**:
1. Install GitHub App (no OAuth needed — GitHub handles app installation independently)
2. On `installation` webhook event: auto-create a workspace with `kind: 'oss_free'` and link the installation
3. Auto-sync public repos only (`is_private = false`)
4. Skip user/member creation until they visit the dashboard

This means adding a new webhook handler for the `installation` event type in the API worker. Currently only `pull_request` and `issue_comment` are handled.

#### 3b. Repository visibility gate
The webhook handler at line 2070 currently finds the repository by `fullName` and creates a review run unconditionally. Add a check:

```
if (repository.isPrivate && workspace.kind === 'oss_free') {
  // Skip review — private repo on free tier
  processingStatus = 'skipped_free_tier';
}
```

The `repositories.is_private` field is already populated during sync from the GitHub API (`workers/api/src/github.ts` line 83: `isPrivate` is parsed from the repo payload via `toGitHubRepository()`).

#### 3c. GitHub App permissions
Current required permissions (inferred from API calls):
- `pull_requests: read` — fetch PR diffs and files
- `pull_requests: write` — post review comments
- `contents: read` — fetch file trees and blobs for indexing
- `issues: read` — detect @codevetter mentions in issue comments

No additional permissions needed for free tier. Public repo content is readable with the installation token.

#### 3d. Workspace kind enum
Add `'oss_free'` to the workspace kind. Currently `WorkspaceKind = 'organization' | 'personal'` in `packages/shared-types/src/v1.ts` line 61. Extend to:

```typescript
export type WorkspaceKind = 'organization' | 'personal' | 'oss_free';
```

#### 3e. Schema changes
New migration `0003_free_tier.sql`:

```sql
-- Add tier tracking to workspaces
ALTER TABLE workspaces ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE workspaces ADD COLUMN tier_pr_limit INTEGER NOT NULL DEFAULT 10;
ALTER TABLE workspaces ADD COLUMN tier_period_start TEXT;

-- Track monthly review counts per repository for rate limiting
CREATE TABLE IF NOT EXISTS repository_usage (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  period TEXT NOT NULL,          -- '2026-04' format
  review_count INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT,
  UNIQUE (repository_id, period)
);

CREATE INDEX IF NOT EXISTS idx_repository_usage_repo ON repository_usage(repository_id);
```

---

## 4. Rate Limiting

### Free tier limits
| Resource | Limit | Period |
|----------|-------|--------|
| PR reviews per repo | 10 | Monthly |
| Total reviews per installation | 50 | Monthly |
| Max files per PR | 50 | Per review |
| Max diff size | 60,000 chars | Per review (half of paid: `MAX_DIFF_CHARS` in `packages/review-core/src/prompt.ts` is 120,000) |
| @codevetter mention triggers | 3 | Per PR |

### Implementation
The rate limit check happens in the webhook handler before creating a review run. The `repository_usage` table (new) tracks monthly counts. Check flow:

1. Webhook arrives at `POST /v1/webhooks/github`
2. Parse the repository and PR
3. Query `repository_usage` for the current period
4. If `review_count >= tier_pr_limit`, skip the review and post a comment:
   > "This repo has reached its free tier limit of 10 reviews/month. [Upgrade to Pro](https://codevetter.com/pricing) for unlimited reviews."
5. Otherwise, increment `review_count` and proceed

The existing rate limiter in the API worker (line 770: IP-based, 120 req/min) stays as-is for API abuse prevention. The new tier-based limiter is separate and specific to review execution.

### Why these numbers
- 10 PRs/month per repo is generous enough to be useful for small-to-medium OSS projects (most repos get <10 PRs/month)
- 50 per installation covers orgs with many repos
- Low enough that heavy users feel the constraint and consider upgrading
- Comparable to Qodo free tier (75 PRs/month) and Greptile trial (50 reviews included)

---

## 5. Upgrade Path

### Free (Public repos only)
- Automated PR reviews on public repos
- Agent detection and agent-specific review rules
- 10 reviews/month per repo
- "Reviewed by CodeVetter" badge on every comment
- Default review tone (balanced)
- @codevetter mention for on-demand reviews

### Pro ($15/user/month)
- Everything in Free
- **Private repo support** — the `is_private` gate is lifted
- **Unlimited reviews** — no monthly cap
- **Custom review rules** — workspace-level (`workspace_rule_defaults`) and per-repo (`repository_rule_overrides`): severity thresholds, blocked patterns, required checks, review tone
- **Team dashboard** — workspace members, audit logs, review history with score trends
- **Full diff analysis** — 120,000 char limit (2x free)
- **Badge removal** — marketing footer stripped from review comments
- **Priority review queue** — paid jobs processed before free tier in the review worker
- **Semantic indexing** — repository codebase indexing for context-aware reviews (`indexing_runs`, `indexed_files`, `semantic_chunks` tables)

### Team ($30/user/month)
- Everything in Pro
- **Slack notifications** — review results posted to a Slack channel
- **Webhook callbacks** — POST review results to a custom URL
- **Custom AI provider** — bring your own API key (OpenAI, Anthropic, OpenRouter) via `workspace_secrets` table
- **Review analytics** — score trends over time, agent vs human comparison, per-developer breakdown
- **SSO/SAML** — enterprise auth
- **Priority support**

### Price rationale
- $15 undercuts CodeRabbit ($24), Ellipsis ($20), Qodo Teams ($19-30)
- $15 matches Bito Team tier
- $30 team tier competitive with Greptile ($30) but includes features Greptile charges extra for (codebase chat)
- CodeVetter's existing infrastructure runs on Cloudflare Workers + D1 — marginal cost per review is near-zero (AI gateway cost only)

### Upgrade triggers
The system creates natural upgrade moments:
1. **Rate limit hit** — "10/10 reviews used this month" comment on PR
2. **Private repo installed** — "CodeVetter free tier is for public repos. [Upgrade to review private repos](https://codevetter.com/pricing)"
3. **Custom rule attempt** — dashboard shows rules editor locked with upgrade CTA
4. **Team growth** — adding workspace members prompts Team tier
5. **Agent-heavy repos** — repos with >50% agent-authored PRs get a targeted upsell: "Your team ships a lot of agent code. Pro tier includes agent-specific review rules and suggestion generation."

---

## 6. SEO Play

### Public review pages on codevetter.com

Every free-tier review generates a public URL:
```
https://codevetter.com/reviews/{owner}/{repo}/pr/{prNumber}
```

This page shows:
- Review score and severity breakdown
- All findings with file paths and line numbers
- Whether the PR was agent-authored (and which agent)
- Link to the GitHub PR
- "Get CodeVetter for your repo" CTA

### Why this matters
- Every reviewed PR creates an indexable page
- Pages target long-tail keywords: `{repo-name} code review`, `{repo-name} PR #{N} review`
- Agent-authored PR reviews target: `claude code review`, `devin code review`, `copilot code review` (from `agentDetection.ts` patterns)
- At 1,000 reviewed PRs/month, that is 1,000 new indexable pages/month
- Review pages link back to GitHub (backlink authority) and GitHub PRs link back to codevetter.com (badge links)

### Implementation
- New route in `apps/landing-page/` (Next.js): `/reviews/[owner]/[repo]/pr/[prNumber]`
- Server-side rendered for SEO (Next.js SSR/ISR)
- Data source: query the API worker (`workers/api/`) for review run + findings by repo fullName and PR number
- Need a new public API endpoint: `GET /v1/public/reviews/{owner}/{repo}/{prNumber}` — returns review data without auth (only for repos on free tier with `is_private = false`)
- Structured data (JSON-LD) for rich search results

### Additional SEO content
- `/reviews/{owner}/{repo}` — repo overview page showing all reviewed PRs, average score, agent %
- `/reviews/{owner}` — org/user overview page
- `/leaderboard` — top-scored OSS repos reviewed by CodeVetter
- Blog-style "monthly OSS review roundup" auto-generated from review data

---

## 7. Distribution

### Phase 1: Foundation (before launch)
1. **GitHub Marketplace listing** — the GitHub App must be listed on marketplace.github.com with a free plan. This is the primary discovery channel.
2. **codevetter.com/install** — one-click install page with GitHub App installation link
3. **README badges** — provide embeddable badges that repos can add to their READMEs
4. **`.codevetter.yml` config** — optional repo-level config file (like `.coderabbit.yaml`) that free-tier users can use for basic settings (enable/disable, ignore paths)

### Phase 2: Launch (week 1-2)
1. **Show HN** — "CodeVetter: Free AI code review for open source repos" — lead with the agent-detection angle, which is genuinely novel
2. **Product Hunt** — launch with demo video showing a Devin/Claude Code PR getting reviewed
3. **Twitter/X threads** — demo reviewing real OSS PRs from popular repos (with permission)
4. **r/programming, r/opensource** — "We built a free AI code reviewer for OSS that detects agent-generated code"

### Phase 3: Organic growth (week 3+)
1. **awesome-code-review** lists — submit to curated GitHub lists
2. **awesome-github-apps** — submit to GitHub App directories
3. **Dev.to / Hashnode articles** — "How we review 1,000 OSS PRs/month for free"
4. **OSS maintainer outreach** — DM maintainers of repos with >100 stars that accept agent PRs, offer free review setup
5. **Conference talks** — "The state of AI-generated code: what we learned reviewing 10,000 agent PRs"

### Phase 4: Viral mechanics (ongoing)
1. **Every review is an ad** — the badge link on every PR comment drives traffic from any developer reading the PR
2. **PR review pages are indexable** — SEO compounds over time
3. **Contributor effect** — when a contributor sees CodeVetter on one repo, they install it on their own repos
4. **Agent tool integrations** — partner with Claude Code, Cursor, Devin to be the recommended reviewer. CodeVetter already detects these agents via `agentDetection.ts` — position as "the tool that validates agent output"

### Metrics to track
| Metric | Target (3 months) | Target (6 months) |
|--------|--------------------|--------------------|
| GitHub App installations | 500 | 5,000 |
| Public repos connected | 1,000 | 10,000 |
| PRs reviewed/month | 2,000 | 20,000 |
| Public review pages indexed | 5,000 | 50,000 |
| Free-to-paid conversion rate | 3% | 5% |
| MRR | $2,000 | $15,000 |

---

## Implementation Phases

### Phase A: Core free tier (2-3 weeks)
**Goal**: Public repos get free reviews with badge

- [ ] Add `installation` webhook handler to `workers/api/src/index.ts` for auto-provisioning
- [ ] Add `tier` column to `workspaces` table, `repository_usage` table (migration `0003_free_tier.sql`)
- [ ] Extend `WorkspaceKind` type in `packages/shared-types/src/v1.ts`
- [ ] Modify `buildOverallBody()` in `packages/review-core/src/formatting.ts` to accept tier and inject badge
- [ ] Add tier-based rate limiting in webhook handler before review run creation
- [ ] Add rate limit exceeded comment via `postPrComment()` in `workers/review/src/github.ts`
- [ ] Create badge SVGs and serve from `apps/landing-page/public/`
- [ ] Test: install GitHub App on a public repo, open PR, verify review + badge

### Phase B: Public review pages + SEO (2 weeks)
**Goal**: Every review creates an indexable page

- [ ] Add `GET /v1/public/reviews/:owner/:repo/:prNumber` endpoint to API worker (no auth, public repos only)
- [ ] Build Next.js pages in `apps/landing-page/`: `/reviews/[owner]/[repo]/pr/[prNumber]`
- [ ] Add JSON-LD structured data to review pages
- [ ] Build repo overview page: `/reviews/[owner]/[repo]`
- [ ] Add sitemap generation for review pages
- [ ] Add OG meta tags for social sharing (score, findings count, agent badge)

### Phase C: GitHub Marketplace + distribution (1 week)
**Goal**: Listed and discoverable

- [ ] Prepare GitHub Marketplace listing (description, screenshots, pricing plans)
- [ ] Set up free plan in GitHub Marketplace
- [ ] Write install docs at `codevetter.com/docs/install`
- [ ] Create README badge generator at `codevetter.com/badge`
- [ ] Prepare Show HN and Product Hunt assets

### Phase D: Paid tier gating (1-2 weeks)
**Goal**: Upgrade path works end-to-end

- [ ] Build pricing page at `codevetter.com/pricing`
- [ ] Implement Stripe integration for Pro/Team billing (or GitHub Marketplace billing)
- [ ] Gate custom rules behind paid tier (check `workspace.tier` before allowing `upsertWorkspaceRuleDefaults`)
- [ ] Gate private repos behind paid tier (check in webhook handler)
- [ ] Build upgrade CTA components for rate limit, private repo, and rules editor
- [ ] Implement priority queue for paid reviews in `workers/review/src/queue.ts`

### Phase E: Growth and iteration (ongoing)
**Goal**: Compound distribution

- [ ] Launch Show HN, Product Hunt
- [ ] Begin OSS maintainer outreach
- [ ] Build review analytics for paid tier
- [ ] Auto-generate monthly OSS review roundup content
- [ ] Track conversion funnel: install -> review -> rate limit -> upgrade
- [ ] A/B test badge designs and CTA copy in review comments

---

## Cost Model

### Per-review cost (Cloudflare Workers + AI gateway)
| Component | Cost per review |
|-----------|----------------|
| Cloudflare Worker execution | ~$0.0001 (50ms avg, 10M free requests/month) |
| D1 database queries | ~$0.0001 (5 reads + 3 writes per review) |
| AI gateway (LLM call) | ~$0.02-0.08 (depends on diff size and model) |
| GitHub API calls | $0 (within rate limits) |
| **Total** | **~$0.03-0.10 per review** |

### Break-even math
At 10,000 free reviews/month:
- Cost: $300-1,000/month (AI gateway dominates)
- Revenue needed: 20-70 paid users at $15/month
- At 3% conversion from 5,000 installations: 150 paid users = $2,250/month

The unit economics work as long as AI gateway costs stay under $0.10/review. Use model routing (cheaper models for simple diffs, expensive models for complex ones) to optimize. The `AI_GATEWAY_MODEL` env var in `workers/review/src/index.ts` line 49 already supports model selection — extend to per-tier model routing.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| AI costs spiral on high-volume repos | Strict rate limits + diff size cap (60k chars free vs 120k paid). Model downgrade for free tier. |
| Low conversion rate | Badge + rate limit create natural upgrade moments. Track which triggers convert best. |
| GitHub App review fatigue (too noisy) | Ship `.codevetter.yml` config for ignore paths/files. Allow disabling via PR label. |
| Competitors copy the free-for-OSS play | CodeRabbit already has a free tier. Differentiate on agent detection (unique) and SEO page strategy (novel). |
| Review quality insufficient at launch | Use the existing review-core pipeline which is already tuned. Start with `balanced` tone. Iterate based on thumbs-up/down reactions on GitHub comments. |
| Abuse (spam repos, CI exploit) | Rate limits per installation. Flag repos with no stars and no contributors. Require at least 1 star or 1 contributor to activate free reviews. |

---

## Key Files Reference

| File | Role |
|------|------|
| `workers/api/src/index.ts` | API worker — webhook handler, auth, workspace CRUD |
| `workers/api/src/github.ts` | GitHub API client (org, repo, PR, tree, blob) |
| `workers/api/src/agentDetection.ts` | Detects agent-authored PRs (bot accounts, body markers, branch prefixes) |
| `workers/review/src/index.ts` | Review worker — processes queued review and indexing jobs |
| `workers/review/src/handlers.ts` | Review job handler — fetches diff, calls AI, posts review |
| `workers/review/src/github.ts` | GitHub App auth (JWT), diff fetching, review posting |
| `workers/review/src/queue.ts` | Job queue (D1 + Postgres adapters) |
| `packages/review-core/src/formatting.ts` | `buildOverallBody()` — generates the PR review comment body |
| `packages/review-core/src/scoring.ts` | `computeScore()`, `determineReviewAction()` |
| `packages/review-core/src/prompt.ts` | `buildPrompt()` — LLM prompt with agent-specific rules |
| `packages/db/src/schema.ts` | Table names enum |
| `packages/db/src/controlPlane.ts` | Database interface + in-memory implementation |
| `packages/db/migrations/0001_init.sql` | Base schema (includes `repositories.is_private`) |
| `packages/db/migrations/0002_agent_metadata.sql` | Agent detection columns on PRs and review runs |
| `packages/shared-types/src/v1.ts` | Core types: `WorkspaceKind`, `ReviewTone`, rule configs |
| `packages/shared-types/src/gateway.ts` | AI gateway request/response types including `AgentContext` |
| `apps/landing-page/` | Next.js marketing site (where review pages and badge routes go) |
| `plans/competitive-landscape-2026-03-22.md` | Competitor pricing and feature analysis |
