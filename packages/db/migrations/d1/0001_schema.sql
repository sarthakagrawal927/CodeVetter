-- Merged D1 (SQLite) schema for CodeVetter control plane
-- Converted from PostgreSQL migrations 0001_init, 0002_agent_metadata, 0003_indexing_tables

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  github_account_type TEXT,
  github_account_id TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  github_user_id TEXT NOT NULL DEFAULT '',
  github_login TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  invited_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  invite_token_hash TEXT NOT NULL UNIQUE,
  invitee_github_login TEXT,
  invitee_email TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_by_user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_installations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  installation_id TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_login TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, installation_id)
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL,
  github_repo_id TEXT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  installation_id TEXT,
  default_branch TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, full_name)
);

CREATE TABLE IF NOT EXISTS workspace_rule_defaults (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  schema_version INTEGER NOT NULL,
  fail_on_findings INTEGER NOT NULL,
  fail_on_severity TEXT NOT NULL,
  max_inline_findings INTEGER NOT NULL,
  min_inline_severity TEXT NOT NULL,
  review_tone TEXT NOT NULL,
  blocked_patterns TEXT NOT NULL,
  required_checks TEXT NOT NULL,
  severity_thresholds TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_rule_overrides (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  schema_version INTEGER NOT NULL,
  fail_on_findings INTEGER NOT NULL,
  fail_on_severity TEXT NOT NULL,
  max_inline_findings INTEGER NOT NULL,
  min_inline_severity TEXT NOT NULL,
  review_tone TEXT NOT NULL,
  blocked_patterns TEXT NOT NULL,
  required_checks TEXT NOT NULL,
  severity_thresholds TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  github_pr_id TEXT,
  pr_number INTEGER NOT NULL,
  title TEXT,
  author_github_login TEXT,
  base_ref TEXT,
  head_ref TEXT,
  head_sha TEXT,
  state TEXT NOT NULL,
  is_agent_authored INTEGER NOT NULL DEFAULT 0,
  agent_name TEXT,
  merged_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repository_id, pr_number)
);

CREATE TABLE IF NOT EXISTS review_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  pull_request_id TEXT REFERENCES pull_requests(id),
  pr_number INTEGER NOT NULL,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  head_sha TEXT,
  score_version TEXT NOT NULL,
  score_composite REAL,
  findings_count INTEGER,
  review_mode TEXT NOT NULL DEFAULT 'standard',
  review_action TEXT NOT NULL DEFAULT 'COMMENT',
  parent_review_run_id TEXT REFERENCES review_runs(id),
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS review_findings (
  id TEXT PRIMARY KEY,
  review_run_id TEXT NOT NULL REFERENCES review_runs(id),
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  suggestion TEXT,
  file_path TEXT,
  line INTEGER,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'open',
  finding_fingerprint TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexing_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  source_ref TEXT,
  status TEXT NOT NULL,
  summary TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  signature_256 TEXT,
  signature_valid INTEGER NOT NULL,
  processing_status TEXT NOT NULL,
  payload TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE (provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_secrets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL,
  key_id TEXT,
  encrypted_value TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, kind)
);

CREATE TABLE IF NOT EXISTS indexed_files (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  path TEXT NOT NULL,
  blob_sha TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  language TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  chunk_strategy TEXT NOT NULL DEFAULT 'tree-sitter',
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repository_id, source_ref, path)
);

CREATE TABLE IF NOT EXISTS semantic_chunks (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_content_sha256 TEXT NOT NULL,
  language TEXT NOT NULL,
  symbol_kind TEXT NOT NULL DEFAULT 'unknown',
  symbol_name TEXT,
  chunk_ordinal INTEGER NOT NULL DEFAULT 0,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_repositories_workspace ON repositories(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repository ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_review_runs_repository ON review_runs(repository_id);
CREATE INDEX IF NOT EXISTS idx_review_findings_run ON review_findings(review_run_id);
CREATE INDEX IF NOT EXISTS idx_indexing_runs_repository ON indexing_runs(repository_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_runs_parent ON review_runs(parent_review_run_id) WHERE parent_review_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_findings_fingerprint ON review_findings(finding_fingerprint) WHERE finding_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indexed_files_repo ON indexed_files(repository_id);
CREATE INDEX IF NOT EXISTS idx_indexed_files_repo_ref ON indexed_files(repository_id, source_ref);
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_repo ON semantic_chunks(repository_id);
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_repo_ref ON semantic_chunks(repository_id, source_ref);
CREATE INDEX IF NOT EXISTS idx_semantic_chunks_symbol ON semantic_chunks(symbol_name) WHERE symbol_name IS NOT NULL;
