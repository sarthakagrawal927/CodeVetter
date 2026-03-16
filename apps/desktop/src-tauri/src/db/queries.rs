use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────
// Row structs
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: String,
    pub display_name: String,
    pub dir_path: String,
    pub session_count: i64,
    pub last_activity: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: String,
    pub project_id: String,
    pub agent_type: String,
    pub jsonl_path: Option<String>,
    pub git_branch: Option<String>,
    pub cwd: Option<String>,
    pub cli_version: Option<String>,
    pub first_message: Option<String>,
    pub last_message: Option<String>,
    pub message_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub model_used: Option<String>,
    pub slug: Option<String>,
    pub file_size_bytes: i64,
    pub indexed_at: Option<String>,
    pub file_mtime: Option<String>,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub compaction_count: i64,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: String,
    pub session_id: String,
    pub parent_uuid: Option<String>,
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
    pub role: Option<String>,
    pub content_text: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub timestamp: Option<String>,
    pub line_number: Option<i64>,
    pub is_sidechain: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub message_id: String,
    pub session_id: String,
    pub content_text: String,
    pub role: Option<String>,
    pub timestamp: Option<String>,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalReviewRow {
    pub id: String,
    pub review_type: Option<String>,
    pub source_label: Option<String>,
    pub repo_path: Option<String>,
    pub repo_full_name: Option<String>,
    pub pr_number: Option<i64>,
    pub agent_used: String,
    pub score_composite: Option<f64>,
    pub findings_count: Option<i64>,
    pub review_action: Option<String>,
    pub summary_markdown: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalReviewFindingRow {
    pub id: String,
    pub review_id: String,
    pub severity: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub suggestion: Option<String>,
    pub file_path: Option<String>,
    pub line: Option<i64>,
    pub confidence: Option<f64>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProcessRow {
    pub id: String,
    pub agent_type: String,
    pub project_path: Option<String>,
    pub session_id: Option<String>,
    pub pid: Option<i64>,
    pub role: Option<String>,
    pub display_name: Option<String>,
    pub status: String,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub estimated_cost_usd: f64,
    pub started_at: Option<String>,
    pub stopped_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskRow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub project_path: Option<String>,
    pub status: String,
    pub assigned_agent: Option<String>,
    pub review_id: Option<String>,
    pub review_score: Option<f64>,
    pub review_attempts: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityRow {
    pub id: String,
    pub agent_id: Option<String>,
    pub event_type: Option<String>,
    pub summary: Option<String>,
    pub metadata: Option<String>,
    pub created_at: String,
}

// ─────────────────────────────────────────────────────────────────
// Input structs (for inserts / upserts)
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInput {
    pub id: String,
    pub display_name: String,
    pub dir_path: String,
    pub session_count: Option<i64>,
    pub last_activity: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInput {
    pub id: String,
    pub project_id: String,
    pub agent_type: Option<String>,
    pub jsonl_path: Option<String>,
    pub git_branch: Option<String>,
    pub cwd: Option<String>,
    pub cli_version: Option<String>,
    pub first_message: Option<String>,
    pub last_message: Option<String>,
    pub message_count: Option<i64>,
    pub total_input_tokens: Option<i64>,
    pub total_output_tokens: Option<i64>,
    pub model_used: Option<String>,
    pub slug: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub indexed_at: Option<String>,
    pub file_mtime: Option<String>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub compaction_count: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageInput {
    pub id: String,
    pub session_id: String,
    pub parent_uuid: Option<String>,
    pub msg_type: Option<String>,
    pub role: Option<String>,
    pub content_text: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub timestamp: Option<String>,
    pub line_number: Option<i64>,
    pub is_sidechain: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalReviewInput {
    pub review_type: Option<String>,
    pub source_label: Option<String>,
    pub repo_path: Option<String>,
    pub repo_full_name: Option<String>,
    pub pr_number: Option<i64>,
    pub agent_used: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocalReviewUpdate {
    pub score_composite: Option<f64>,
    pub findings_count: Option<i64>,
    pub review_action: Option<String>,
    pub summary_markdown: Option<String>,
    pub status: Option<String>,
    pub error_message: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalReviewFindingInput {
    pub review_id: String,
    pub severity: String,
    pub title: String,
    pub summary: String,
    pub suggestion: Option<String>,
    pub file_path: Option<String>,
    pub line: Option<i64>,
    pub confidence: Option<f64>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskInput {
    pub title: String,
    pub description: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub project_path: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTaskUpdate {
    pub status: Option<String>,
    pub assigned_agent: Option<String>,
    pub review_id: Option<String>,
    pub review_score: Option<f64>,
    pub review_attempts: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityInput {
    pub agent_id: Option<String>,
    pub event_type: Option<String>,
    pub summary: Option<String>,
    pub metadata: Option<String>,
}

// ─────────────────────────────────────────────────────────────────
// Lightweight session lookup (for incremental indexing)
// ─────────────────────────────────────────────────────────────────

/// Minimal row returned when looking up an existing session by its JSONL path.
/// Used by the indexer to decide whether to skip unchanged files and where to
/// resume reading for append-only incremental indexing.
#[derive(Debug, Clone)]
pub struct SessionMeta {
    pub id: String,
    pub file_size_bytes: i64,
    pub file_mtime: Option<String>,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub message_count: i64,
    pub cache_read_tokens: i64,
    pub cache_creation_tokens: i64,
    pub compaction_count: i64,
}

/// Look up the stored session metadata for a given `jsonl_path`.
/// Returns `None` if the file has never been indexed.
pub fn get_session_by_jsonl_path(
    conn: &Connection,
    jsonl_path: &str,
) -> Result<Option<SessionMeta>, rusqlite::Error> {
    conn.query_row(
        "SELECT id, file_size_bytes, file_mtime, total_input_tokens,
                total_output_tokens, message_count, cache_read_tokens,
                cache_creation_tokens, compaction_count
         FROM cc_sessions
         WHERE jsonl_path = ?1",
        params![jsonl_path],
        |row| {
            Ok(SessionMeta {
                id: row.get(0)?,
                file_size_bytes: row.get(1)?,
                file_mtime: row.get(2)?,
                total_input_tokens: row.get(3)?,
                total_output_tokens: row.get(4)?,
                message_count: row.get(5)?,
                cache_read_tokens: row.get(6)?,
                cache_creation_tokens: row.get(7)?,
                compaction_count: row.get(8)?,
            })
        },
    )
    .optional()
}

/// Look up a project by its `dir_path`.  Returns the project ID if found.
pub fn get_project_id_by_dir(
    conn: &Connection,
    dir_path: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT id FROM cc_projects WHERE dir_path = ?1",
        params![dir_path],
        |row| row.get(0),
    )
    .optional()
}

// ─────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────

pub fn list_projects(conn: &Connection) -> Result<Vec<ProjectRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, dir_path, session_count, last_activity, created_at
         FROM cc_projects
         ORDER BY last_activity DESC NULLS LAST",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ProjectRow {
            id: row.get(0)?,
            display_name: row.get(1)?,
            dir_path: row.get(2)?,
            session_count: row.get(3)?,
            last_activity: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_project(conn: &Connection, p: &ProjectInput) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO cc_projects (id, display_name, dir_path, session_count, last_activity, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
             display_name  = excluded.display_name,
             dir_path      = excluded.dir_path,
             session_count = COALESCE(excluded.session_count, cc_projects.session_count),
             last_activity = COALESCE(excluded.last_activity, cc_projects.last_activity)",
        params![
            p.id,
            p.display_name,
            p.dir_path,
            p.session_count.unwrap_or(0),
            p.last_activity,
            p.created_at,
        ],
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────

pub fn list_sessions(
    conn: &Connection,
    query: Option<&str>,
    project: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<SessionRow>, rusqlite::Error> {
    // Build a dynamic query.  We use simple string matching for the
    // optional filters because rusqlite doesn't support truly dynamic
    // parameter counts in a simple way — the LIKE '%' trick works fine.
    let sql = "
        SELECT s.id, s.project_id, s.agent_type, s.jsonl_path, s.git_branch,
               s.cwd, s.cli_version, s.first_message, s.last_message,
               s.message_count, s.total_input_tokens, s.total_output_tokens,
               s.model_used, s.slug, s.file_size_bytes, s.indexed_at, s.file_mtime,
               s.cache_read_tokens, s.cache_creation_tokens,
               s.compaction_count, s.estimated_cost_usd
        FROM cc_sessions s
        WHERE (?1 IS NULL OR s.project_id = ?1)
          AND (?2 IS NULL OR s.slug LIKE '%' || ?2 || '%'
                          OR s.cwd  LIKE '%' || ?2 || '%'
                          OR s.first_message LIKE '%' || ?2 || '%')
        ORDER BY s.last_message DESC NULLS LAST
        LIMIT ?3 OFFSET ?4
    ";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![project, query, limit, offset], |row| {
        Ok(SessionRow {
            id: row.get(0)?,
            project_id: row.get(1)?,
            agent_type: row.get(2)?,
            jsonl_path: row.get(3)?,
            git_branch: row.get(4)?,
            cwd: row.get(5)?,
            cli_version: row.get(6)?,
            first_message: row.get(7)?,
            last_message: row.get(8)?,
            message_count: row.get(9)?,
            total_input_tokens: row.get(10)?,
            total_output_tokens: row.get(11)?,
            model_used: row.get(12)?,
            slug: row.get(13)?,
            file_size_bytes: row.get(14)?,
            indexed_at: row.get(15)?,
            file_mtime: row.get(16)?,
            cache_read_tokens: row.get(17)?,
            cache_creation_tokens: row.get(18)?,
            compaction_count: row.get(19)?,
            estimated_cost_usd: row.get(20)?,
        })
    })?;
    rows.collect()
}

pub fn upsert_session(conn: &Connection, s: &SessionInput) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO cc_sessions (
            id, project_id, agent_type, jsonl_path, git_branch, cwd,
            cli_version, first_message, last_message, message_count,
            total_input_tokens, total_output_tokens, model_used, slug,
            file_size_bytes, indexed_at, file_mtime,
            cache_read_tokens, cache_creation_tokens, compaction_count,
            estimated_cost_usd
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)
         ON CONFLICT(id) DO UPDATE SET
            project_id         = excluded.project_id,
            agent_type         = COALESCE(excluded.agent_type, cc_sessions.agent_type),
            jsonl_path         = COALESCE(excluded.jsonl_path, cc_sessions.jsonl_path),
            git_branch         = COALESCE(excluded.git_branch, cc_sessions.git_branch),
            cwd                = COALESCE(excluded.cwd, cc_sessions.cwd),
            cli_version        = COALESCE(excluded.cli_version, cc_sessions.cli_version),
            first_message      = COALESCE(excluded.first_message, cc_sessions.first_message),
            last_message       = COALESCE(excluded.last_message, cc_sessions.last_message),
            message_count      = COALESCE(excluded.message_count, cc_sessions.message_count),
            total_input_tokens = COALESCE(excluded.total_input_tokens, cc_sessions.total_input_tokens),
            total_output_tokens= COALESCE(excluded.total_output_tokens, cc_sessions.total_output_tokens),
            model_used         = COALESCE(excluded.model_used, cc_sessions.model_used),
            slug               = COALESCE(excluded.slug, cc_sessions.slug),
            file_size_bytes    = COALESCE(excluded.file_size_bytes, cc_sessions.file_size_bytes),
            indexed_at         = COALESCE(excluded.indexed_at, cc_sessions.indexed_at),
            file_mtime         = COALESCE(excluded.file_mtime, cc_sessions.file_mtime),
            cache_read_tokens  = COALESCE(excluded.cache_read_tokens, cc_sessions.cache_read_tokens),
            cache_creation_tokens = COALESCE(excluded.cache_creation_tokens, cc_sessions.cache_creation_tokens),
            compaction_count   = COALESCE(excluded.compaction_count, cc_sessions.compaction_count),
            estimated_cost_usd = COALESCE(excluded.estimated_cost_usd, cc_sessions.estimated_cost_usd)",
        params![
            s.id,
            s.project_id,
            s.agent_type.as_deref().unwrap_or("claude-code"),
            s.jsonl_path,
            s.git_branch,
            s.cwd,
            s.cli_version,
            s.first_message,
            s.last_message,
            s.message_count.unwrap_or(0),
            s.total_input_tokens.unwrap_or(0),
            s.total_output_tokens.unwrap_or(0),
            s.model_used,
            s.slug,
            s.file_size_bytes.unwrap_or(0),
            s.indexed_at,
            s.file_mtime,
            s.cache_read_tokens.unwrap_or(0),
            s.cache_creation_tokens.unwrap_or(0),
            s.compaction_count.unwrap_or(0),
            s.estimated_cost_usd.unwrap_or(0.0),
        ],
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────

pub fn get_session_messages(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<MessageRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, parent_uuid, type, role, content_text,
                model, input_tokens, output_tokens, timestamp, line_number, is_sidechain
         FROM cc_messages
         WHERE session_id = ?1
         ORDER BY line_number ASC, timestamp ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(MessageRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            parent_uuid: row.get(2)?,
            msg_type: row.get(3)?,
            role: row.get(4)?,
            content_text: row.get(5)?,
            model: row.get(6)?,
            input_tokens: row.get(7)?,
            output_tokens: row.get(8)?,
            timestamp: row.get(9)?,
            line_number: row.get(10)?,
            is_sidechain: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn search_messages(
    conn: &Connection,
    query: &str,
) -> Result<Vec<SearchResult>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.session_id, m.content_text, m.role, m.timestamp,
                fts.rank
         FROM cc_messages_fts fts
         JOIN cc_messages m ON m.rowid = fts.rowid
         WHERE cc_messages_fts MATCH ?1
         ORDER BY fts.rank
         LIMIT 100",
    )?;
    let rows = stmt.query_map(params![query], |row| {
        Ok(SearchResult {
            message_id: row.get(0)?,
            session_id: row.get(1)?,
            content_text: row.get(2)?,
            role: row.get(3)?,
            timestamp: row.get(4)?,
            rank: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn insert_message(conn: &Connection, m: &MessageInput) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO cc_messages (
            id, session_id, parent_uuid, type, role, content_text,
            model, input_tokens, output_tokens, timestamp, line_number, is_sidechain
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![
            m.id,
            m.session_id,
            m.parent_uuid,
            m.msg_type,
            m.role,
            m.content_text,
            m.model,
            m.input_tokens,
            m.output_tokens,
            m.timestamp,
            m.line_number,
            m.is_sidechain.unwrap_or(0),
        ],
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Local Reviews
// ─────────────────────────────────────────────────────────────────

pub fn create_local_review(
    conn: &Connection,
    input: &LocalReviewInput,
) -> Result<String, rusqlite::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO local_reviews (
            id, review_type, source_label, repo_path, repo_full_name,
            pr_number, agent_used, status, created_at, started_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            input.review_type,
            input.source_label,
            input.repo_path,
            input.repo_full_name,
            input.pr_number,
            input.agent_used.as_deref().unwrap_or("claude-code"),
            input.status.as_deref().unwrap_or("pending"),
            now,
            now,
        ],
    )?;
    Ok(id)
}

pub fn update_local_review(
    conn: &Connection,
    id: &str,
    u: &LocalReviewUpdate,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE local_reviews SET
            score_composite  = COALESCE(?2, score_composite),
            findings_count   = COALESCE(?3, findings_count),
            review_action    = COALESCE(?4, review_action),
            summary_markdown = COALESCE(?5, summary_markdown),
            status           = COALESCE(?6, status),
            error_message    = COALESCE(?7, error_message),
            completed_at     = COALESCE(?8, completed_at)
         WHERE id = ?1",
        params![
            id,
            u.score_composite,
            u.findings_count,
            u.review_action,
            u.summary_markdown,
            u.status,
            u.error_message,
            u.completed_at,
        ],
    )?;
    Ok(())
}

pub fn insert_review_finding(
    conn: &Connection,
    input: &LocalReviewFindingInput,
) -> Result<String, rusqlite::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO local_review_findings (
            id, review_id, severity, title, summary, suggestion,
            file_path, line, confidence, fingerprint
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            input.review_id,
            input.severity,
            input.title,
            input.summary,
            input.suggestion,
            input.file_path,
            input.line,
            input.confidence,
            input.fingerprint,
        ],
    )?;
    Ok(id)
}

pub fn list_local_reviews(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Vec<LocalReviewRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, review_type, source_label, repo_path, repo_full_name,
                pr_number, agent_used, score_composite, findings_count,
                review_action, summary_markdown, status, error_message,
                started_at, completed_at, created_at
         FROM local_reviews
         ORDER BY created_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit, offset], |row| {
        Ok(LocalReviewRow {
            id: row.get(0)?,
            review_type: row.get(1)?,
            source_label: row.get(2)?,
            repo_path: row.get(3)?,
            repo_full_name: row.get(4)?,
            pr_number: row.get(5)?,
            agent_used: row.get(6)?,
            score_composite: row.get(7)?,
            findings_count: row.get(8)?,
            review_action: row.get(9)?,
            summary_markdown: row.get(10)?,
            status: row.get(11)?,
            error_message: row.get(12)?,
            started_at: row.get(13)?,
            completed_at: row.get(14)?,
            created_at: row.get(15)?,
        })
    })?;
    rows.collect()
}

pub fn get_local_review_with_findings(
    conn: &Connection,
    review_id: &str,
) -> Result<(LocalReviewRow, Vec<LocalReviewFindingRow>), rusqlite::Error> {
    let review = conn.query_row(
        "SELECT id, review_type, source_label, repo_path, repo_full_name,
                pr_number, agent_used, score_composite, findings_count,
                review_action, summary_markdown, status, error_message,
                started_at, completed_at, created_at
         FROM local_reviews WHERE id = ?1",
        params![review_id],
        |row| {
            Ok(LocalReviewRow {
                id: row.get(0)?,
                review_type: row.get(1)?,
                source_label: row.get(2)?,
                repo_path: row.get(3)?,
                repo_full_name: row.get(4)?,
                pr_number: row.get(5)?,
                agent_used: row.get(6)?,
                score_composite: row.get(7)?,
                findings_count: row.get(8)?,
                review_action: row.get(9)?,
                summary_markdown: row.get(10)?,
                status: row.get(11)?,
                error_message: row.get(12)?,
                started_at: row.get(13)?,
                completed_at: row.get(14)?,
                created_at: row.get(15)?,
            })
        },
    )?;

    let mut stmt = conn.prepare(
        "SELECT id, review_id, severity, title, summary, suggestion,
                file_path, line, confidence, fingerprint
         FROM local_review_findings
         WHERE review_id = ?1
         ORDER BY severity DESC, line ASC",
    )?;
    let findings = stmt
        .query_map(params![review_id], |row| {
            Ok(LocalReviewFindingRow {
                id: row.get(0)?,
                review_id: row.get(1)?,
                severity: row.get(2)?,
                title: row.get(3)?,
                summary: row.get(4)?,
                suggestion: row.get(5)?,
                file_path: row.get(6)?,
                line: row.get(7)?,
                confidence: row.get(8)?,
                fingerprint: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok((review, findings))
}

// ─────────────────────────────────────────────────────────────────
// Agent Tasks
// ─────────────────────────────────────────────────────────────────

pub fn create_agent_task(
    conn: &Connection,
    input: &AgentTaskInput,
) -> Result<String, rusqlite::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO agent_tasks (id, title, description, acceptance_criteria, project_path, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            input.title,
            input.description,
            input.acceptance_criteria,
            input.project_path,
            input.status.as_deref().unwrap_or("backlog"),
            now,
            now,
        ],
    )?;
    Ok(id)
}

pub fn update_agent_task(
    conn: &Connection,
    id: &str,
    u: &AgentTaskUpdate,
) -> Result<(), rusqlite::Error> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE agent_tasks SET
            status          = COALESCE(?2, status),
            assigned_agent  = COALESCE(?3, assigned_agent),
            review_id       = COALESCE(?4, review_id),
            review_score    = COALESCE(?5, review_score),
            review_attempts = COALESCE(?6, review_attempts),
            updated_at      = ?7
         WHERE id = ?1",
        params![
            id,
            u.status,
            u.assigned_agent,
            u.review_id,
            u.review_score,
            u.review_attempts,
            now,
        ],
    )?;
    Ok(())
}

pub fn list_agent_tasks(
    conn: &Connection,
    status: Option<&str>,
) -> Result<Vec<AgentTaskRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, title, description, acceptance_criteria, project_path, status,
                assigned_agent, review_id, review_score, review_attempts,
                created_at, updated_at
         FROM agent_tasks
         WHERE (?1 IS NULL OR status = ?1)
         ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(params![status], |row| {
        Ok(AgentTaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            acceptance_criteria: row.get(3)?,
            project_path: row.get(4)?,
            status: row.get(5)?,
            assigned_agent: row.get(6)?,
            review_id: row.get(7)?,
            review_score: row.get(8)?,
            review_attempts: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;
    rows.collect()
}

// ─────────────────────────────────────────────────────────────────
// Activity Log
// ─────────────────────────────────────────────────────────────────

pub fn log_activity(conn: &Connection, entry: &ActivityInput) -> Result<(), rusqlite::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO activity_log (id, agent_id, event_type, summary, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, entry.agent_id, entry.event_type, entry.summary, entry.metadata, now],
    )?;
    Ok(())
}

pub fn list_activity(
    conn: &Connection,
    agent_id: Option<&str>,
    limit: i64,
) -> Result<Vec<ActivityRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, event_type, summary, metadata, created_at
         FROM activity_log
         WHERE (?1 IS NULL OR agent_id = ?1)
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![agent_id, limit], |row| {
        Ok(ActivityRow {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            event_type: row.get(2)?,
            summary: row.get(3)?,
            metadata: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

// ─────────────────────────────────────────────────────────────────
// Agent Processes
// ─────────────────────────────────────────────────────────────────

pub fn insert_agent_process(
    conn: &Connection,
    agent: &AgentProcessRow,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO agent_processes (
            id, agent_type, project_path, session_id, pid, role,
            display_name, status, total_input_tokens, total_output_tokens,
            estimated_cost_usd, started_at, stopped_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            agent.id,
            agent.agent_type,
            agent.project_path,
            agent.session_id,
            agent.pid,
            agent.role,
            agent.display_name,
            agent.status,
            agent.total_input_tokens,
            agent.total_output_tokens,
            agent.estimated_cost_usd,
            agent.started_at,
            agent.stopped_at,
        ],
    )?;
    Ok(())
}

pub fn update_agent_process_status(
    conn: &Connection,
    id: &str,
    status: &str,
    stopped_at: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE agent_processes SET status = ?2, stopped_at = COALESCE(?3, stopped_at) WHERE id = ?1",
        params![id, status, stopped_at],
    )?;
    Ok(())
}

pub fn list_agent_processes(conn: &Connection) -> Result<Vec<AgentProcessRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, agent_type, project_path, session_id, pid, role,
                display_name, status, total_input_tokens, total_output_tokens,
                estimated_cost_usd, started_at, stopped_at
         FROM agent_processes
         ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AgentProcessRow {
            id: row.get(0)?,
            agent_type: row.get(1)?,
            project_path: row.get(2)?,
            session_id: row.get(3)?,
            pid: row.get(4)?,
            role: row.get(5)?,
            display_name: row.get(6)?,
            status: row.get(7)?,
            total_input_tokens: row.get(8)?,
            total_output_tokens: row.get(9)?,
            estimated_cost_usd: row.get(10)?,
            started_at: row.get(11)?,
            stopped_at: row.get(12)?,
        })
    })?;
    rows.collect()
}

pub fn get_agent_process(
    conn: &Connection,
    id: &str,
) -> Result<Option<AgentProcessRow>, rusqlite::Error> {
    conn.query_row(
        "SELECT id, agent_type, project_path, session_id, pid, role,
                display_name, status, total_input_tokens, total_output_tokens,
                estimated_cost_usd, started_at, stopped_at
         FROM agent_processes WHERE id = ?1",
        params![id],
        |row| {
            Ok(AgentProcessRow {
                id: row.get(0)?,
                agent_type: row.get(1)?,
                project_path: row.get(2)?,
                session_id: row.get(3)?,
                pid: row.get(4)?,
                role: row.get(5)?,
                display_name: row.get(6)?,
                status: row.get(7)?,
                total_input_tokens: row.get(8)?,
                total_output_tokens: row.get(9)?,
                estimated_cost_usd: row.get(10)?,
                started_at: row.get(11)?,
                stopped_at: row.get(12)?,
            })
        },
    )
    .optional()
}

// ─────────────────────────────────────────────────────────────────
// Agent Messages (inter-agent chat)
// ─────────────────────────────────────────────────────────────────

pub fn insert_agent_message(
    conn: &Connection,
    thread_id: &str,
    sender_type: &str,
    sender_agent_id: Option<&str>,
    content: &str,
    mentions: Option<&str>,
) -> Result<String, rusqlite::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO agent_messages (id, thread_id, sender_type, sender_agent_id, content, mentions, delivered, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        params![id, thread_id, sender_type, sender_agent_id, content, mentions, now],
    )?;
    Ok(id)
}

// ─────────────────────────────────────────────────────────────────
// Agent Messages — thread listing
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessageRow {
    pub id: String,
    pub thread_id: String,
    pub sender_type: String,
    pub sender_agent_id: Option<String>,
    pub content: String,
    pub mentions: Option<String>,
    pub delivered: i64,
    pub created_at: String,
}

pub fn list_agent_messages(
    conn: &Connection,
    thread_id: &str,
    limit: i64,
) -> Result<Vec<AgentMessageRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, sender_type, sender_agent_id, content,
                mentions, delivered, created_at
         FROM agent_messages
         WHERE thread_id = ?1
         ORDER BY created_at ASC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![thread_id, limit], |row| {
        Ok(AgentMessageRow {
            id: row.get(0)?,
            thread_id: row.get(1)?,
            sender_type: row.get(2)?,
            sender_agent_id: row.get(3)?,
            content: row.get(4)?,
            mentions: row.get(5)?,
            delivered: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

// ─────────────────────────────────────────────────────────────────
// Agent Cost — aggregation and logging
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCostSummary {
    pub agent_id: String,
    pub agent_type: String,
    pub display_name: Option<String>,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
    pub entry_count: i64,
}

pub fn get_cost_dashboard(conn: &Connection) -> Result<Vec<AgentCostSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.agent_type, p.display_name,
                COALESCE(SUM(c.input_tokens), 0),
                COALESCE(SUM(c.output_tokens), 0),
                COALESCE(SUM(c.cost_usd), 0.0),
                COUNT(c.id)
         FROM agent_processes p
         LEFT JOIN agent_cost_log c ON c.agent_id = p.id
         GROUP BY p.id
         ORDER BY COALESCE(SUM(c.cost_usd), 0.0) DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AgentCostSummary {
            agent_id: row.get(0)?,
            agent_type: row.get(1)?,
            display_name: row.get(2)?,
            total_input_tokens: row.get(3)?,
            total_output_tokens: row.get(4)?,
            total_cost_usd: row.get(5)?,
            entry_count: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn log_agent_cost(
    conn: &Connection,
    agent_id: &str,
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
) -> Result<(), rusqlite::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO agent_cost_log (id, agent_id, model, input_tokens, output_tokens, cost_usd)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, agent_id, model, input_tokens, output_tokens, cost_usd],
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Agent Presets
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPresetRow {
    pub id: String,
    pub name: String,
    pub adapter: String,
    pub role: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub max_turns: Option<i64>,
    pub allowed_tools: Option<String>,
    pub output_format: Option<String>,
    pub print_mode: i64,
    pub no_session_persist: i64,
    pub approval_mode: Option<String>,
    pub quiet_mode: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_agent_presets(conn: &Connection) -> Result<Vec<AgentPresetRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, adapter, role, system_prompt, model, max_turns,
                allowed_tools, output_format, print_mode, no_session_persist,
                approval_mode, quiet_mode, created_at, updated_at
         FROM agent_presets
         ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AgentPresetRow {
            id: row.get(0)?,
            name: row.get(1)?,
            adapter: row.get(2)?,
            role: row.get(3)?,
            system_prompt: row.get(4)?,
            model: row.get(5)?,
            max_turns: row.get(6)?,
            allowed_tools: row.get(7)?,
            output_format: row.get(8)?,
            print_mode: row.get(9)?,
            no_session_persist: row.get(10)?,
            approval_mode: row.get(11)?,
            quiet_mode: row.get(12)?,
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
        })
    })?;
    rows.collect()
}

pub fn create_agent_preset(conn: &Connection, preset: &AgentPresetRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO agent_presets (
            id, name, adapter, role, system_prompt, model, max_turns,
            allowed_tools, output_format, print_mode, no_session_persist,
            approval_mode, quiet_mode, created_at, updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            preset.id,
            preset.name,
            preset.adapter,
            preset.role,
            preset.system_prompt,
            preset.model,
            preset.max_turns,
            preset.allowed_tools,
            preset.output_format,
            preset.print_mode,
            preset.no_session_persist,
            preset.approval_mode,
            preset.quiet_mode,
            preset.created_at,
            preset.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_agent_preset(conn: &Connection, preset: &AgentPresetRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE agent_presets SET
            name = ?2, adapter = ?3, role = ?4, system_prompt = ?5,
            model = ?6, max_turns = ?7, allowed_tools = ?8,
            output_format = ?9, print_mode = ?10, no_session_persist = ?11,
            approval_mode = ?12, quiet_mode = ?13, updated_at = ?14
         WHERE id = ?1",
        params![
            preset.id,
            preset.name,
            preset.adapter,
            preset.role,
            preset.system_prompt,
            preset.model,
            preset.max_turns,
            preset.allowed_tools,
            preset.output_format,
            preset.print_mode,
            preset.no_session_persist,
            preset.approval_mode,
            preset.quiet_mode,
            preset.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_agent_preset(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM agent_presets WHERE id = ?1", params![id])?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Provider Accounts
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderAccountRow {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub api_key: Option<String>,
    pub monthly_limit: Option<f64>,
    pub plan: Option<String>,
    pub weekly_limit: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_provider_accounts(conn: &Connection) -> Result<Vec<ProviderAccountRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, provider, api_key, monthly_limit, plan, weekly_limit, created_at, updated_at
         FROM provider_accounts
         ORDER BY provider ASC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ProviderAccountRow {
            id: row.get(0)?,
            name: row.get(1)?,
            provider: row.get(2)?,
            api_key: row.get(3)?,
            monthly_limit: row.get(4)?,
            plan: row.get(5)?,
            weekly_limit: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn create_provider_account(conn: &Connection, account: &ProviderAccountRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO provider_accounts (id, name, provider, api_key, monthly_limit, plan, weekly_limit, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            account.id,
            account.name,
            account.provider,
            account.api_key,
            account.monthly_limit,
            account.plan,
            account.weekly_limit,
            account.created_at,
            account.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_provider_account(conn: &Connection, account: &ProviderAccountRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE provider_accounts SET name = ?2, provider = ?3, api_key = ?4,
         monthly_limit = ?5, plan = ?6, weekly_limit = ?7, updated_at = ?8
         WHERE id = ?1",
        params![
            account.id,
            account.name,
            account.provider,
            account.api_key,
            account.monthly_limit,
            account.plan,
            account.weekly_limit,
            account.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete_provider_account(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM provider_accounts WHERE id = ?1", params![id])?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Preferences
// ─────────────────────────────────────────────────────────────────

pub fn get_preference(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT value FROM preferences WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_preference(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO preferences (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Index Stats (aggregate counts)
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    pub project_count: i64,
    pub session_count: i64,
    pub message_count: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
}

pub fn get_index_stats(conn: &Connection) -> Result<IndexStats, rusqlite::Error> {
    let project_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM cc_projects", [], |r| r.get(0))?;
    let session_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM cc_sessions", [], |r| r.get(0))?;
    let message_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM cc_messages", [], |r| r.get(0))?;
    let total_input_tokens: i64 =
        conn.query_row("SELECT COALESCE(SUM(total_input_tokens), 0) FROM cc_sessions", [], |r| r.get(0))?;
    let total_output_tokens: i64 =
        conn.query_row("SELECT COALESCE(SUM(total_output_tokens), 0) FROM cc_sessions", [], |r| r.get(0))?;
    let total_cost_usd: f64 =
        conn.query_row("SELECT COALESCE(SUM(estimated_cost_usd), 0.0) FROM cc_sessions", [], |r| r.get(0))?;
    Ok(IndexStats {
        project_count,
        session_count,
        message_count,
        total_input_tokens,
        total_output_tokens,
        total_cost_usd,
    })
}

// ─────────────────────────────────────────────────────────────────
// Workspaces
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceRow {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub branch: String,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    pub status: String,
    pub session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

pub fn list_workspaces(
    conn: &Connection,
    status_filter: Option<&str>,
) -> Result<Vec<WorkspaceRow>, rusqlite::Error> {
    let sql = "
        SELECT id, name, repo_path, branch, pr_number, pr_url,
               status, session_id, created_at, updated_at, archived_at
        FROM workspaces
        WHERE (?1 IS NULL OR status = ?1)
        ORDER BY updated_at DESC
    ";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![status_filter], |row| {
        Ok(WorkspaceRow {
            id: row.get(0)?,
            name: row.get(1)?,
            repo_path: row.get(2)?,
            branch: row.get(3)?,
            pr_number: row.get(4)?,
            pr_url: row.get(5)?,
            status: row.get(6)?,
            session_id: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            archived_at: row.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn get_workspace(
    conn: &Connection,
    id: &str,
) -> Result<Option<WorkspaceRow>, rusqlite::Error> {
    conn.query_row(
        "SELECT id, name, repo_path, branch, pr_number, pr_url,
                status, session_id, created_at, updated_at, archived_at
         FROM workspaces WHERE id = ?1",
        params![id],
        |row| {
            Ok(WorkspaceRow {
                id: row.get(0)?,
                name: row.get(1)?,
                repo_path: row.get(2)?,
                branch: row.get(3)?,
                pr_number: row.get(4)?,
                pr_url: row.get(5)?,
                status: row.get(6)?,
                session_id: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                archived_at: row.get(10)?,
            })
        },
    )
    .optional()
}

pub fn create_workspace(conn: &Connection, w: &WorkspaceRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO workspaces (
            id, name, repo_path, branch, pr_number, pr_url,
            status, session_id, created_at, updated_at, archived_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            w.id,
            w.name,
            w.repo_path,
            w.branch,
            w.pr_number,
            w.pr_url,
            w.status,
            w.session_id,
            w.created_at,
            w.updated_at,
            w.archived_at,
        ],
    )?;
    Ok(())
}

pub fn update_workspace(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    branch: Option<&str>,
    status: Option<&str>,
    session_id: Option<&str>,
    pr_number: Option<i64>,
    pr_url: Option<&str>,
    updated_at: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE workspaces SET
            name       = COALESCE(?2, name),
            branch     = COALESCE(?3, branch),
            status     = COALESCE(?4, status),
            session_id = COALESCE(?5, session_id),
            pr_number  = COALESCE(?6, pr_number),
            pr_url     = COALESCE(?7, pr_url),
            updated_at = ?8
         WHERE id = ?1",
        params![id, name, branch, status, session_id, pr_number, pr_url, updated_at],
    )?;
    Ok(())
}

pub fn archive_workspace(conn: &Connection, id: &str, now: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE workspaces SET archived_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn unarchive_workspace(conn: &Connection, id: &str, now: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE workspaces SET archived_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn delete_workspace(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// Chat Tabs
// ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatTabRow {
    pub id: String,
    pub title: String,
    pub session_id: Option<String>,
    pub project_path: Option<String>,
    pub model: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub fn list_chat_tabs(conn: &Connection) -> Result<Vec<ChatTabRow>, rusqlite::Error> {
    let sql = "
        SELECT id, title, session_id, project_path, model, position, created_at, updated_at
        FROM chat_tabs
        ORDER BY position ASC
    ";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(ChatTabRow {
            id: row.get(0)?,
            title: row.get(1)?,
            session_id: row.get(2)?,
            project_path: row.get(3)?,
            model: row.get(4)?,
            position: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn get_chat_tab(conn: &Connection, id: &str) -> Result<Option<ChatTabRow>, rusqlite::Error> {
    conn.query_row(
        "SELECT id, title, session_id, project_path, model, position, created_at, updated_at
         FROM chat_tabs WHERE id = ?1",
        params![id],
        |row| {
            Ok(ChatTabRow {
                id: row.get(0)?,
                title: row.get(1)?,
                session_id: row.get(2)?,
                project_path: row.get(3)?,
                model: row.get(4)?,
                position: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .optional()
}

pub fn create_chat_tab(conn: &Connection, tab: &ChatTabRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO chat_tabs (id, title, session_id, project_path, model, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            tab.id,
            tab.title,
            tab.session_id,
            tab.project_path,
            tab.model,
            tab.position,
            tab.created_at,
            tab.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update_chat_tab(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    session_id: Option<&str>,
    model: Option<&str>,
    project_path: Option<&str>,
    position: Option<i64>,
    updated_at: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE chat_tabs SET
            title        = COALESCE(?2, title),
            session_id   = COALESCE(?3, session_id),
            model        = COALESCE(?4, model),
            project_path = COALESCE(?5, project_path),
            position     = COALESCE(?6, position),
            updated_at   = ?7
         WHERE id = ?1",
        params![id, title, session_id, model, project_path, position, updated_at],
    )?;
    Ok(())
}

pub fn delete_chat_tab(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM chat_tabs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn reorder_chat_tabs(conn: &Connection, tab_ids: &[String], updated_at: &str) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare(
        "UPDATE chat_tabs SET position = ?2, updated_at = ?3 WHERE id = ?1",
    )?;
    for (i, id) in tab_ids.iter().enumerate() {
        stmt.execute(params![id, i as i64, updated_at])?;
    }
    Ok(())
}

pub fn next_chat_tab_position(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let max: Option<i64> = conn.query_row(
        "SELECT MAX(position) FROM chat_tabs",
        [],
        |row| row.get(0),
    )?;
    Ok(max.unwrap_or(-1) + 1)
}
