# v1 Technical Questions and Challenges

Use this file as the decision log for v1 implementation.

## Q1. Primary database choice

- Why it matters: repository/rule/run/history consistency and query model.
- Options:
  - Postgres (recommended baseline)
  - DynamoDB / document store
- Current status: decided
- Decision: Postgres-compatible CockroachDB.

## Q2. Queue and background execution model

- Why it matters: review/indexing reliability and retry semantics.
- Options:
  - SQS + worker autoscaling
  - Redis Streams / BullMQ
  - NATS JetStream
- Current status: decided
- Decision: Cloudflare Queues for async review/indexing jobs.
- Topology: separate queues (`review-jobs`, `indexing-jobs`) in v1.
- Retry policy: `3` retries before terminal failure / DLQ handoff.

## Q3. GitHub integration model

- Why it matters: webhook trust, installation token lifecycle, org-level install UX.
- Options:
  - GitHub App (recommended)
  - PAT-based integration (not recommended for scale)
- Current status: decided
- Decision: GitHub App only for v1.

## Q4. Multi-tenant isolation boundaries

- Why it matters: data leakage risk and blast radius.
- Options:
  - row-level tenancy (workspace_id column)
  - per-tenant schema/database
- Current status: decided
- Decision:
  - v1 hierarchy: `org -> repo` and `org -> member`.
  - team-level hierarchy deferred to v1.1.
  - row-level tenancy on shared tables (`org_id` partition key).

## Q5. Rule schema and policy DSL scope

- Why it matters: long-term flexibility vs complexity.
- Options:
  - typed JSON config with versioned schema (recommended)
  - custom DSL interpreted by policy engine
- Current status: decided
- Decision: typed JSON config with schema versioning.

## Q6. Indexing depth in v1

- Why it matters: cost/latency tradeoff.
- Options:
  - metadata + key files + embeddings subset (recommended)
  - full repo AST + embeddings for all files
- Current status: decided
- Decision: full indexing for all repository-tracked files available via GitHub, relying on repository hygiene (for example `.gitignore`) for noise control.
- Guardrail: max file size `10MB` for indexing in v1.

## Q7. Secrets model for BYOK in hosted v1

- Why it matters: compliance and support burden.
- Options:
  - BYOK only
  - platform-managed key only
  - hybrid (both)
- Current status: deferred
- Decision: defer managed-key policy discussion; prioritize BYOK path in v1 implementation.

## Q11. Permission Freshness Model

- Why it matters: authorization drift and correctness of org/member/repo access.
- Options:
  - webhook-driven updates + periodic reconcile
  - webhook-only
- Current status: deferred
- Decision: defer to v1.1.

## Q8. PR scoring versioning policy

- Why it matters: historical comparability and trust.
- Options:
  - immutable `score_version` per run (recommended)
  - mutable latest formula only
- Current status: open

## Q9. Auth and org membership model

- Why it matters: dashboard permissions and enterprise readiness.
- Options:
  - GitHub OAuth only for v1 (recommended)
  - custom auth + SCIM/SAML in v1
- Current status: open

## Q10. Deployment topology

- Why it matters: cost and operational complexity.
- Options:
  - single-region API + workers for v1 (recommended)
  - multi-region active-active from day one
- Current status: open
