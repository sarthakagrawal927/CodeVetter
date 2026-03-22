# CodeVetter Roadmap

## Completed

### Desktop App — Conductor Parity
- [x] Warm amber design system
- [x] Workspace architecture (3-column layout, git integration)
- [x] Multi-tab chat with persistence
- [x] Command palette (Cmd+K)
- [x] Real terminal (xterm.js + portable-pty)
- [x] File explorer + diff viewer
- [x] PR management + CI status via gh CLI
- [x] Diff commenting with inline line selection
- [x] Keyboard shortcuts + cheatsheet
- [x] Context meter, sidebar toggle, zen mode

### Beyond Conductor
- [x] CRDT multi-agent coordination (all 5 phases)
- [x] Linear OAuth integration
- [x] System resource monitor
- [x] Slash commands dropdown
- [x] Thinking/Plan/Fast mode toggles
- [x] Playwright test generator (URL + description -> generate -> run -> iterate)
- [x] Persona-based Agent Squad (read from ~/.claude/agents/, CRUD)
- [x] Floating pill nav bar (auto-hide, icon-only, tooltips)
- [x] shadcn/ui component library setup

### Restructure
- [x] Nav: Home, Workspaces, Board, History, Settings (5 items)
- [x] Sessions → History (read-only, no chat input)
- [x] Review + Test Gen → Board column actions (not separate pages)
- [x] Kanban: To Do, In Progress, Review, Test (4 columns)
- [x] Agent Squad: persona cards with CRUD, assign tasks directly

### Cloud Platform
- [x] Cloudflare Workers (API + review worker)
- [x] Next.js dashboard on Vercel
- [x] Landing page on Vercel
- [x] CockroachDB with indexing tables
- [x] GitHub OAuth + RBAC
- [x] Webhook ingestion with signature validation

### Infrastructure
- [x] Husky pre-commit (lint-staged) + pre-push hooks
- [x] ESLint flat config (0 warnings)
- [x] Rust 0 warnings
- [x] Memory efficiency fixes
- [x] Workspaces.tsx split into 5 modules
- [x] Dead code removed, .gitignore + .env.example
- [x] tauri:dev port fix (1420, auto-kill)

---

## In Progress

### shadcn/ui Migration
- [x] Setup: 10 components (Button, Card, Badge, Tooltip, Dialog, etc.)
- [x] Board page migrated (persona cards, modals, kanban)
- [x] Floating nav migrated (tooltips, separators)
- [ ] Home page migration
- [ ] History page migration
- [ ] Settings page migration
- [ ] Workspaces page migration
- [ ] Command palette migration

### E2E Workflow Verification
- [ ] Create workspace → chat → review → PR → merge (full flow audit)

---

## Planned

### Review Experience (Next Priority)
- [ ] Rich review dashboard inside Workspace (not just findings list)
- [ ] Severity-ranked findings with file/line links
- [ ] Cross-file analysis ("this change breaks assumption in other file")
- [ ] Approve/dismiss individual findings with reasons
- [ ] Auto-generated review summary
- [ ] Post review to GitHub as formal review
- [ ] Track review quality over time (signal vs noise)

### Embeddings & RAG
- [ ] Choose embedding model (text-embedding-3-small or free alternative)
- [ ] Generate vector embeddings for tree-sitter code chunks
- [ ] Store embeddings in semantic_chunks table
- [ ] Vector search for RAG context during reviews
- [ ] Feed relevant code chunks into review prompts

### Desktop Polish
- [ ] Live session detection — match Claude processes to sessions by cwd
- [ ] Auto-trigger usage refresh (periodic, not manual /usage)
- [ ] Update Playwright e2e tests for new UI structure

### Cloud
- [ ] Re-verify dashboard + landing page deployments after desktop sprint
- [ ] Re-verify API + review worker deployments
- [ ] Apply 0003_indexing_tables.sql migration to production CockroachDB

### Symphony-Style Agent Orchestration
Inspired by [OpenAI Symphony](https://github.com/openai/symphony). Cherry-pick the good patterns:
- [ ] WORKFLOW.md per-repo — version agent prompt + settings with the code
- [ ] Auto-polling Linear — continuous 30s polling instead of manual import
- [ ] Retry with exponential backoff — auto-retry failed agent runs
- [ ] Reconciliation — stop agents when Linear issues are closed/terminal
- [ ] Per-issue workspace isolation (already have Workspaces, need auto-creation from issues)
- [ ] Concurrency limits (global + per-state)
- [ ] Multi-turn agent sessions (agent continues until issue is done, not just one response)
- [ ] Optional: Codex app-server protocol support alongside Claude CLI

### Future Exploration
- [ ] Go sidecar for heavy processing (if needed at scale)
- [ ] Durable workflows for long-running reviews (if needed)
- [ ] SaaS Maker re-integration (after data restore)
- [ ] Cross-repo coordinated reviews
- [ ] Function-level file claiming (tree-sitter powered)
