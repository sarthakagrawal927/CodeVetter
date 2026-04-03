-- Free tier support: workspace tiers and per-repo usage tracking

ALTER TABLE workspaces ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';

-- Track monthly review counts per repository for rate limiting
CREATE TABLE IF NOT EXISTS repository_usage (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  period TEXT NOT NULL,
  review_count INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT,
  UNIQUE (repository_id, period)
);

CREATE INDEX IF NOT EXISTS idx_repository_usage_repo ON repository_usage(repository_id);
