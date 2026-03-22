# CodeVetter Roadmap

> Desktop-first. Web later. Core thesis: force agents to write less code.
> Previous roadmap archived at `plans/2026-03-21-roadmap-pre-consolidation.md`.

## Completed

### Phase 1: Cleanup
- [x] Sidecar eliminated — review-core runs directly in webview
- [x] Dead code removed (8 components, 2 pages, -2700 lines)
- [x] shadcn/ui migration (Sessions, Workspaces, command-palette)
- [x] History page made read-only (no merge, no delete)
- [x] Board page restructured (Linear-style: sidebar squad + full kanban)
- [x] Agent launches linked to kanban tasks (in_progress + assigned agent)
- [x] Workspace status grouping removed (flat list)
- [x] Git history cleaned (removed 2GB+ build artifacts)

### Phase 2: Local Code Review
- [x] Review pipeline in webview (review-service.ts → review-core → ai-gateway-client)
- [x] AI Provider config in Settings (Anthropic/OpenAI/OpenRouter/Custom)
- [x] Review prompt tuned for agent bloat detection
- [x] review-dashboard rewired (no sidecar, no polling, direct pipeline)

### Foundation (prior work)
- [x] Desktop app (Tauri + React + Vite)
- [x] Conductor parity (workspaces, chat, terminal, file explorer, diff viewer)
- [x] Agent Squad + Kanban board
- [x] Session history + usage tracking
- [x] Cloud platform built (workers, CockroachDB, GitHub OAuth) — on hold

---

## Phase 3: Review Feedback Loop (next)

Close the loop: review → findings → agent fixes → re-review.

- [ ] Custom review rules per repo/language
  - Rules editor in workspace settings (e.g., "use Tailwind not MUI", "async/await not .then()")
  - Store in local SQLite per workspace
  - Inject into buildPrompt alongside agent rules
- [ ] Auto-send findings back to agent
  - When task in "Review" column scores below threshold
  - Format findings as agent instructions: "Fix these issues: [findings]"
  - Re-launch agent with fix instructions → re-review on completion
  - Stop loop when score >= threshold or max attempts reached
- [ ] Review results UI polish
  - Severity-ranked findings with file/line links
  - Approve/dismiss individual findings
  - Review history per repo

---

## Phase 4: PR Review via GitHub PAT

Desktop-local PR review. No server needed.

- [ ] GitHub PAT config in Settings (already partially built)
- [ ] PR picker UI (list repos/PRs from PAT)
- [ ] Review flow: fetch diff → review-core → display findings
- [ ] Post review back to GitHub as PR comment
- [ ] Track review quality over time

---

## Phase 5: Conductor Polish

- [ ] Symphony-style agent orchestration (WORKFLOW.md, auto-polling Linear, retry, reconciliation)
- [ ] Live session detection (match Claude processes to sessions by cwd)
- [ ] Per-issue workspace isolation
- [ ] Concurrency limits + multi-turn agent sessions

---

## Phase 6: Semantic Indexing

Detect duplicate/similar functions to catch agent copy-paste.

- [ ] Embedding-based similarity search for code symbols
- [ ] "You added X but Y already exists" findings
- [ ] Tree-sitter symbol extraction + vector storage

---

## Phase 7: Web App

Same React app, stripped down, deployed to Vercel.

- [ ] Abstract Tauri IPC behind provider pattern (Tauri vs HTTP)
- [ ] GitHub App integration (team-scale, webhook-driven)
- [ ] Fold useful dashboard pages into shared codebase
- [ ] Deploy web variant

---

## Not Doing

- ~~Sidecar binary~~ — eliminated
- ~~RAG for reviews~~ — diff + good prompt is enough
- ~~Full file indexing for review context~~ — overkill, build catches import errors
- ~~Separate web dashboard~~ — same codebase as desktop
- ~~Supabase~~ — using CockroachDB/D1
