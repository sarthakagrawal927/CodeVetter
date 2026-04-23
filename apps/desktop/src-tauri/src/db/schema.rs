use rusqlite::Connection;

/// Run every migration in order.  Each statement is idempotent
/// (`IF NOT EXISTS`) so this function is safe to call on every startup.
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(MIGRATION_SQL)?;

    // Incremental migrations — safe to re-run (ignore "duplicate column" errors).
    let _ = conn.execute("ALTER TABLE agent_tasks ADD COLUMN project_path TEXT", []);
    let _ = conn.execute("ALTER TABLE provider_accounts ADD COLUMN plan TEXT", []);
    let _ = conn.execute("ALTER TABLE provider_accounts ADD COLUMN weekly_limit REAL", []);
    let _ = conn.execute("ALTER TABLE agent_tasks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)", []);

    Ok(())
}

/// One-time cleanup: remove non-message metadata rows that used to be indexed
/// and reclaim disk space. Guarded by a preference flag so it only runs once.
/// Expensive on large databases — run on a background thread after startup.
pub fn purge_message_cruft_once(conn: &Connection) {
    let already: Option<String> = conn
        .query_row(
            "SELECT value FROM preferences WHERE key = 'cruft_purged_v1'",
            [],
            |r| r.get(0),
        )
        .ok();
    if already.is_some() {
        return;
    }

    // FTS sync triggers fire once per deleted row. On ~10M rows that turns
    // a 10-second DELETE into a multi-hour ordeal. Drop the triggers, do
    // the DELETE, then rebuild the FTS index from the survivors in one shot.
    // Triggers are recreated (they're idempotent in MIGRATION_SQL and will
    // come back on next startup; we also recreate them here so live search
    // works until restart).
    let tx_result: Result<u64, rusqlite::Error> = (|| {
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS cc_messages_ai;
             DROP TRIGGER IF EXISTS cc_messages_ad;
             DROP TRIGGER IF EXISTS cc_messages_au;",
        )?;

        let deleted = conn.execute(
            "DELETE FROM cc_messages
             WHERE type IN (
                 'queue-operation', 'last-prompt', 'permission-mode',
                 'pr-link', 'agent-name', 'custom-title', 'attachment',
                 'file-history-snapshot', 'progress'
             )",
            [],
        )? as u64;

        conn.execute_batch(
            "INSERT INTO cc_messages_fts(cc_messages_fts) VALUES('rebuild');
             CREATE TRIGGER IF NOT EXISTS cc_messages_ai AFTER INSERT ON cc_messages BEGIN
                 INSERT INTO cc_messages_fts(rowid, content_text)
                 VALUES (new.rowid, new.content_text);
             END;
             CREATE TRIGGER IF NOT EXISTS cc_messages_ad AFTER DELETE ON cc_messages BEGIN
                 INSERT INTO cc_messages_fts(cc_messages_fts, rowid, content_text)
                 VALUES ('delete', old.rowid, old.content_text);
             END;
             CREATE TRIGGER IF NOT EXISTS cc_messages_au AFTER UPDATE ON cc_messages BEGIN
                 INSERT INTO cc_messages_fts(cc_messages_fts, rowid, content_text)
                 VALUES ('delete', old.rowid, old.content_text);
                 INSERT INTO cc_messages_fts(rowid, content_text)
                 VALUES (new.rowid, new.content_text);
             END;",
        )?;
        Ok(deleted)
    })();

    let total = match tx_result {
        Ok(n) => n,
        Err(e) => {
            eprintln!("[storage] purge failed: {e}");
            return;
        }
    };

    eprintln!("[storage] purged {total} cruft message rows");

    // Refresh query planner stats after a large shape change. ANALYZE
    // rebuilds sqlite_stat1 so index choices reflect the new row counts.
    // Also checkpoint and truncate the WAL — after a 10M-row DELETE it
    // holds multi-GB of dead pages.
    let _ = conn.execute_batch(
        "ANALYZE cc_messages;
         PRAGMA wal_checkpoint(TRUNCATE);",
    );

    let _ = conn.execute(
        "INSERT OR REPLACE INTO preferences(key, value) VALUES ('cruft_purged_v1', '1')",
        [],
    );
}

const MIGRATION_SQL: &str = r#"
-- ================================================================
-- Claude Code Session Index
-- ================================================================

CREATE TABLE IF NOT EXISTS cc_projects (
    id             TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    dir_path       TEXT UNIQUE NOT NULL,
    session_count  INTEGER NOT NULL DEFAULT 0,
    last_activity  TEXT,
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cc_sessions (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL REFERENCES cc_projects(id),
    agent_type         TEXT NOT NULL DEFAULT 'claude-code',
    jsonl_path         TEXT UNIQUE,
    git_branch         TEXT,
    cwd                TEXT,
    cli_version        TEXT,
    first_message      TEXT,
    last_message       TEXT,
    message_count      INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    model_used         TEXT,
    slug               TEXT,
    file_size_bytes    INTEGER NOT NULL DEFAULT 0,
    indexed_at         TEXT,
    file_mtime         TEXT,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    compaction_count   INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cc_messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES cc_sessions(id) ON DELETE CASCADE,
    parent_uuid   TEXT,
    type          TEXT,
    role          TEXT,
    content_text  TEXT,
    model         TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    timestamp     TEXT,
    line_number   INTEGER,
    is_sidechain  INTEGER NOT NULL DEFAULT 0
);

-- FTS5 virtual table for full-text search across messages.
-- We use an external-content table so that inserts go through
-- cc_messages and are mirrored via triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS cc_messages_fts USING fts5(
    content_text,
    content=cc_messages,
    content_rowid=rowid
);

-- Triggers to keep the FTS index in sync ----------------------------

-- After INSERT on cc_messages
CREATE TRIGGER IF NOT EXISTS cc_messages_ai AFTER INSERT ON cc_messages BEGIN
    INSERT INTO cc_messages_fts(rowid, content_text)
    VALUES (new.rowid, new.content_text);
END;

-- After DELETE on cc_messages
CREATE TRIGGER IF NOT EXISTS cc_messages_ad AFTER DELETE ON cc_messages BEGIN
    INSERT INTO cc_messages_fts(cc_messages_fts, rowid, content_text)
    VALUES ('delete', old.rowid, old.content_text);
END;

-- After UPDATE on cc_messages
CREATE TRIGGER IF NOT EXISTS cc_messages_au AFTER UPDATE ON cc_messages BEGIN
    INSERT INTO cc_messages_fts(cc_messages_fts, rowid, content_text)
    VALUES ('delete', old.rowid, old.content_text);
    INSERT INTO cc_messages_fts(rowid, content_text)
    VALUES (new.rowid, new.content_text);
END;


-- ================================================================
-- Local Reviews
-- ================================================================

CREATE TABLE IF NOT EXISTS local_reviews (
    id               TEXT PRIMARY KEY,
    review_type      TEXT,
    source_label     TEXT,
    repo_path        TEXT,
    repo_full_name   TEXT,
    pr_number        INTEGER,
    agent_used       TEXT NOT NULL DEFAULT 'claude-code',
    score_composite  REAL,
    findings_count   INTEGER,
    review_action    TEXT,
    summary_markdown TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    error_message    TEXT,
    started_at       TEXT,
    completed_at     TEXT,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_review_findings (
    id          TEXT PRIMARY KEY,
    review_id   TEXT NOT NULL REFERENCES local_reviews(id) ON DELETE CASCADE,
    severity    TEXT,
    title       TEXT,
    summary     TEXT,
    suggestion  TEXT,
    file_path   TEXT,
    line        INTEGER,
    confidence  REAL,
    fingerprint TEXT
);


-- ================================================================
-- Mission Control
-- ================================================================

CREATE TABLE IF NOT EXISTS agent_processes (
    id                  TEXT PRIMARY KEY,
    agent_type          TEXT NOT NULL,
    project_path        TEXT,
    session_id          TEXT,
    pid                 INTEGER,
    role                TEXT,
    display_name        TEXT,
    status              TEXT NOT NULL DEFAULT 'running',
    total_input_tokens  INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd  REAL NOT NULL DEFAULT 0,
    started_at          TEXT,
    stopped_at          TEXT
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    description         TEXT,
    acceptance_criteria TEXT,
    project_path        TEXT,
    status              TEXT NOT NULL DEFAULT 'backlog',
    assigned_agent      TEXT REFERENCES agent_processes(id),
    review_id           TEXT REFERENCES local_reviews(id),
    review_score        REAL,
    review_attempts     INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS activity_log (
    id         TEXT PRIMARY KEY,
    agent_id   TEXT REFERENCES agent_processes(id),
    event_type TEXT,
    summary    TEXT,
    metadata   TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created
    ON activity_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_agent_created
    ON activity_log(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
    id              TEXT PRIMARY KEY,
    thread_id       TEXT NOT NULL,
    sender_type     TEXT,
    sender_agent_id TEXT REFERENCES agent_processes(id),
    content         TEXT,
    mentions        TEXT,
    delivered       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread
    ON agent_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_cost_log (
    id            TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL REFERENCES agent_processes(id),
    model         TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      REAL,
    recorded_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_cost_log_agent
    ON agent_cost_log(agent_id, recorded_at);


-- ================================================================
-- Agent Presets (reusable agent configurations)
-- ================================================================

CREATE TABLE IF NOT EXISTS agent_presets (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    adapter         TEXT NOT NULL DEFAULT 'claude-code',
    role            TEXT,
    system_prompt   TEXT,
    model           TEXT,
    max_turns       INTEGER,
    allowed_tools   TEXT,
    output_format   TEXT,
    print_mode      INTEGER NOT NULL DEFAULT 0,
    no_session_persist INTEGER NOT NULL DEFAULT 0,
    approval_mode   TEXT,
    quiet_mode      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- ================================================================
-- Provider Accounts (API key configs with usage limits)
-- ================================================================

CREATE TABLE IF NOT EXISTS provider_accounts (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    provider       TEXT NOT NULL,          -- 'anthropic' | 'openai'
    api_key        TEXT,                   -- optional, for querying usage APIs
    monthly_limit  REAL,                   -- USD budget cap (null = unlimited)
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

-- ================================================================
-- Preferences (key-value)
-- ================================================================

CREATE TABLE IF NOT EXISTS preferences (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ================================================================
-- Workspaces
-- ================================================================

CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    repo_path   TEXT NOT NULL,
    branch      TEXT NOT NULL,
    pr_number   INTEGER,
    pr_url      TEXT,
    status      TEXT NOT NULL DEFAULT 'in_progress',
    session_id  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspaces_status
    ON workspaces(status);

-- ================================================================
-- Chat Tabs
-- ================================================================

CREATE TABLE IF NOT EXISTS chat_tabs (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL DEFAULT 'Untitled',
    session_id    TEXT,
    project_path  TEXT,
    model         TEXT NOT NULL DEFAULT 'sonnet',
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

-- ================================================================
-- Diff Comments
-- ================================================================

CREATE TABLE IF NOT EXISTS diff_comments (
    id                 TEXT PRIMARY KEY,
    workspace_id       TEXT NOT NULL,
    file_path          TEXT NOT NULL,
    start_line         INTEGER NOT NULL,
    end_line           INTEGER NOT NULL,
    content            TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'draft',
    github_comment_id  TEXT,
    author             TEXT NOT NULL DEFAULT 'local',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diff_comments_workspace
    ON diff_comments(workspace_id);

-- ================================================================
-- Agent Talks (structured handover between agent runs)
-- ================================================================

CREATE TABLE IF NOT EXISTS agent_talks (
    id                      TEXT PRIMARY KEY,
    agent_process_id        TEXT REFERENCES agent_processes(id),
    review_id               TEXT REFERENCES local_reviews(id),
    agent_type              TEXT NOT NULL,
    project_path            TEXT NOT NULL,
    role                    TEXT,

    input_prompt            TEXT NOT NULL,
    input_context           TEXT,

    files_read              TEXT,
    files_modified          TEXT,
    actions_summary         TEXT,

    output_raw              TEXT,
    output_structured       TEXT,
    exit_code               INTEGER,

    unfinished_work         TEXT,
    blockers                TEXT,

    key_decisions           TEXT,
    codebase_state          TEXT,
    recommended_next_steps  TEXT,

    duration_ms             INTEGER,
    session_id              TEXT,
    created_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_talks_project
    ON agent_talks(project_path, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_talks_review
    ON agent_talks(review_id);

-- Speed up time-windowed token stats (today/week/month/year, daily/weekly series).
CREATE INDEX IF NOT EXISTS idx_cc_messages_timestamp
    ON cc_messages(timestamp);

CREATE INDEX IF NOT EXISTS idx_cc_messages_session_ts
    ON cc_messages(session_id, timestamp);

-- Required by the one-time cruft purge (WHERE type IN (...)) — without this
-- each batch does a full table scan, turning the purge into O(N²).
CREATE INDEX IF NOT EXISTS idx_cc_messages_type
    ON cc_messages(type);

-- Token usage stats bucket by last_message (session-level aggregation —
-- see queries::get_token_usage_stats for the rationale on session vs
-- message granularity).
CREATE INDEX IF NOT EXISTS idx_cc_sessions_last_message
    ON cc_sessions(last_message);
"#;
