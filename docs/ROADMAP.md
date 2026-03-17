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
- [x] Subagent visibility in sessions
- [x] System resource monitor
- [x] Slash commands dropdown
- [x] Thinking/Plan/Fast mode toggles
- [x] Playwright test generator (URL + description -> generate -> run -> iterate)

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
- [x] Sessions made read-only
- [x] Dead code removed, .gitignore + .env.example

---

## Planned

### Embeddings & RAG
- [ ] Choose embedding model (text-embedding-3-small or free alternative)
- [ ] Generate vector embeddings for tree-sitter code chunks
- [ ] Store embeddings in semantic_chunks table
- [ ] Vector search for RAG context during reviews
- [ ] Feed relevant code chunks into review prompts

### Desktop Polish
- [ ] Live session detection — match Claude processes to sessions by cwd
- [ ] Auto-trigger usage refresh (periodic, not manual /usage)
- [ ] End-to-end user flow testing (workspace -> chat -> review -> PR -> merge)
- [ ] Update Playwright e2e tests for new UI structure

### Cloud
- [ ] Re-verify dashboard + landing page deployments after desktop sprint
- [ ] Re-verify API + review worker deployments
- [ ] Apply 0003_indexing_tables.sql migration to production CockroachDB

### Future Exploration
- [ ] Go sidecar for heavy processing (if needed at scale)
- [ ] Durable workflows for long-running reviews (Golem/Temporal, if needed)
- [ ] SaaS Maker re-integration (after data restore)
- [ ] Cross-repo coordinated reviews
- [ ] Function-level file claiming (tree-sitter powered)
