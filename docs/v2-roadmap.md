# v2 Roadmap: Codebase Evolution Intelligence

v2 focuses on longitudinal code intelligence beyond point-in-time PR review.

## Objectives

- Detect architecture drift over time.
- Predict hotspots and instability before regressions happen.
- Track ownership and review quality trends.
- Introduce evolution-aware scoring guidance.

## Core Capabilities

- Evolution timelines per repository/module/file
- Churn and risk hotspot maps
- Regression links back to prior PRs and findings
- Team quality velocity views
- Rule recommendation engine based on historical outcomes
- Per-repo changelog generation

## Planned Phases

### Phase 1: Evolution Foundations

- Build ingestion and snapshot infrastructure.
- Compute baseline evolution metrics and trend windows.
- Expose core evolution APIs and dashboard views.

### Phase 2: Repository Changelog Files

- Automatically generate a changelog file for each connected repository.
- Default target path: `.code-reviewer/CHANGELOG.md`.
- Changelog content includes:
  - PR score deltas and notable findings
  - hotspot/module trend changes
  - rule recommendation summaries
- Update strategy:
  - append/update on merged PRs
  - open an automated PR with changelog updates when direct writes are disabled

## Planned Data Pipeline

1. Ingest PR metadata and review output continuously.
2. Build periodic repository snapshots.
3. Compute file and module evolution metrics.
4. Store vector context versions for temporal comparisons.
5. Maintain rolling windows (7/30/90 day).

## Planned Data Model Additions

- `repo_snapshots`
- `file_evolution_metrics`
- `module_evolution_metrics`
- `author_quality_metrics`
- `architecture_signals`
- `regression_links`
- `score_versions`

## Planned v2 APIs

- `GET /api/v2/repositories/:id/evolution/overview`
- `GET /api/v2/repositories/:id/evolution/hotspots`
- `GET /api/v2/repositories/:id/evolution/modules/:moduleId`
- `GET /api/v2/repositories/:id/evolution/authors`
- `POST /api/v2/repositories/:id/evolution/recompute`
- `GET /api/v2/repositories/:id/rules/recommendations`
