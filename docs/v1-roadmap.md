# v1 Roadmap: Hosted Review Platform

v1 moves from standalone action setup to a hosted product with onboarding, repository context, and configurable policy.

## Product Surfaces

1. Landing page
2. Dashboard (auth, org/repo connection, settings)
3. GitHub app + onboarding automation

## Dashboard Scope

- Repository connection and installation status
- Manual drift check button (no auto reconcile in v1)
- Rule configuration and severity thresholds
- Review history and PR score timeline
- Team/member views and ownership metrics
- Standard account surfaces (workspace settings, members, notifications)

## v1 User Flow

1. User signs in and connects GitHub repository.
2. Platform creates onboarding commit/PR adding workflow + config YAML.
3. Repository is indexed for baseline context.
4. User configures review rules and thresholds in dashboard.
5. New PRs are reviewed against:
   - user-specific rules
   - platform default rules
6. PR receives score + findings + value-added signal.

## Core Features

- Repo connection and install status
- Rule management UI (severity thresholds, style/safety constraints)
- Repository semantic indexing pipeline with Tree-sitter chunking (vector retrieval deferred to v1.1)
- PR scoring in dashboard and PR comments
- Combined policy engine:
  - user-defined rules
  - platform default rules
- Team and author metrics
  - average PR quality
  - risk density
  - review pass/fail trend
  - commit quality trend

## Data and Services

- API service for auth, repos, rules, and reports
- Review worker service for PR event processing
- Storage for repository metadata, rule sets, and review results

## Success Criteria

- New repo setup in <10 minutes
- Deterministic policy application from dashboard rules
- Stable PR scoring and explainable finding traceability
- Historical PR quality metrics visible per repo and author
- Value-added score visible on each reviewed PR

## Decision Log

Track unresolved engineering choices in `/Users/sarthakagrawal/Desktop/code-reviewer/docs/v1-technical-questions.md`.
Indexing implementation details are tracked in `/Users/sarthakagrawal/Desktop/code-reviewer/docs/v1-indexing-spec.md`.
