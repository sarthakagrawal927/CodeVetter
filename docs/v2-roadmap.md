# v2 Roadmap: Codebase Evolution Intelligence

v2 extends v1 from point-in-time PR review to longitudinal intelligence across repositories, modules, and teams.

## Objective

Give teams a clear view of how code quality evolves over time, not only what is wrong in a single PR.

## What v2 Adds

1. Architecture drift detection
2. Hotspot prediction and instability alerts
3. Ownership and review quality trends
4. Evolution-aware scoring and guidance
5. Changelog generation per repository

## Evolution Capabilities

- Evolution timeline per repo/module/file
- Churn-risk maps and volatility tracking
- Regression links from incidents back to prior PR decisions
- Quality velocity trend per team/author
- Rule recommendations tuned by observed repo behavior

## Per-Repo Changelog (Requested)

Each connected repo gets a managed changelog file:

- Default path: `.code-reviewer/CHANGELOG.md`
- Updated on merged PR windows
- Includes:
  - PR score movement
  - key findings and repeated patterns
  - hotspot/module trend deltas
  - rule recommendation highlights

When direct pushes are not allowed, platform opens an automation PR with changelog updates.

## Data Pipeline

1. Ingest PR metadata, findings, scores, and changed hunks
2. Build periodic code structure snapshots
3. Compute file/module evolution metrics
4. Maintain temporal context versions for “what changed since X”
5. Compute rolling windows (7d, 30d, 90d)

## Planned Data Model

- `repo_snapshots`
- `file_evolution_metrics`
- `module_evolution_metrics`
- `author_quality_metrics`
- `architecture_signals`
- `regression_links`
- `score_versions`

## v2 Scoring Model

Add evolution-aware components:

- `stability_score`
- `maintainability_delta`
- `review_effectiveness`

Composite:

`v2_composite = 0.30 quality + 0.20 (100-risk) + 0.20 value + 0.15 stability + 0.15 maintainability_delta`

## v2 APIs

- `GET /api/v2/repositories/:id/evolution/overview`
- `GET /api/v2/repositories/:id/evolution/hotspots`
- `GET /api/v2/repositories/:id/evolution/modules/:moduleId`
- `GET /api/v2/repositories/:id/evolution/authors`
- `POST /api/v2/repositories/:id/evolution/recompute`
- `GET /api/v2/repositories/:id/rules/recommendations`

## Product Surfaces

- Dashboard Evolution tab
  - hotspot map
  - drift timeline
  - PR quality velocity
- Weekly health reports
  - top-risk modules
- Rule recommendation panel
  - suggested threshold changes
  - new pattern rules from observed regressions

## v2 Testing Plan

1. Evolution metrics update correctly across sequential PRs
2. Hotspot ranking matches known synthetic churn patterns
3. Regression linking maps incidents to prior PR windows correctly
4. Rule recommendation engine is deterministic
5. v1 and v2 scores coexist without dashboard regressions
