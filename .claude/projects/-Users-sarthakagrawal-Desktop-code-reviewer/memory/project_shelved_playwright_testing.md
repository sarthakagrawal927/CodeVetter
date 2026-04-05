---
name: Shelved - AI Playwright Testing Feature
description: Idea to add AI-driven Playwright E2E testing was explored and shelved. Could revisit as a "verify the fix" feature in v2+.
type: project
---

## Shelved Idea: AI-Powered Playwright Testing (2026-03-11)

**Concept:** Users provide auth + instructions, AI uses Playwright to run E2E tests on their app.

**Decision:** Shelved. Not pursuing now.

**Reasons:**
- Market already crowded (Browserbase, Momentic, QA Wolf, Shortest, Drizzle AI)
- Tangential to core code review value prop
- Expensive to run on every PR; running only before releases makes it an afterthought
- Would split focus from core product

**Potential future angle:** "Verify the fix" step triggered by review intelligence — differentiated because it's driven by CodeVetter's review findings, not generic E2E. Only revisit if users explicitly ask for it.
