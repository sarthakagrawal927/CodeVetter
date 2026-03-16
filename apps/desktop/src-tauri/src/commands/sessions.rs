use crate::db::queries;
use crate::DbState;
use serde_json::{json, Value};
use tauri::State;

/// List subagents for a given session.
///
/// Looks for JSONL files under:
///   `~/.claude/projects/<encoded-project-path>/<session_id>/subagents/agent-*.jsonl`
///
/// Returns a summary for each subagent found.
#[tauri::command]
pub async fn list_session_subagents(
    session_id: String,
    project_path: String,
) -> Result<Value, String> {
    use std::io::BufRead;

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());

    // Encode project path the same way Claude Code does:
    // /Users/foo/bar → -Users-foo-bar
    let encoded_project = project_path.replace('/', "-");

    let subagents_dir = std::path::PathBuf::from(&home)
        .join(".claude")
        .join("projects")
        .join(&encoded_project)
        .join(&session_id)
        .join("subagents");

    if !subagents_dir.exists() || !subagents_dir.is_dir() {
        return Ok(json!({ "subagents": [] }));
    }

    let mut subagents = Vec::new();

    let entries = std::fs::read_dir(&subagents_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Only process agent-*.jsonl files
        if !file_name.starts_with("agent-") || !file_name.ends_with(".jsonl") {
            continue;
        }

        // Extract agent ID from filename: agent-<id>.jsonl → <id>
        let agent_id = file_name
            .strip_prefix("agent-")
            .and_then(|s| s.strip_suffix(".jsonl"))
            .unwrap_or(&file_name)
            .to_string();

        let file = match std::fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let reader = std::io::BufReader::new(file);
        let mut all_lines: Vec<String> = Vec::new();
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => all_lines.push(l),
                _ => {}
            }
        }

        let line_count = all_lines.len();
        let mut slug: Option<String> = None;
        let mut started_at: Option<String> = None;
        let mut ended_at: Option<String> = None;
        let mut task_description: Option<String> = None;

        // Parse first few lines for start time, slug, and task description
        let head_count = std::cmp::min(20, all_lines.len());
        for line in &all_lines[..head_count] {
            let parsed: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if started_at.is_none() {
                started_at = parsed
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from);
            }

            if slug.is_none() {
                slug = parsed
                    .get("slug")
                    .and_then(|v| v.as_str())
                    .map(String::from);
            }

            // Look for the task description in the initial user/human message content
            if task_description.is_none() {
                // Try message.content for the task prompt
                if let Some(msg) = parsed.get("message") {
                    let role = msg.get("role").and_then(|v| v.as_str());
                    if role == Some("user") || role == Some("human") {
                        if let Some(content) = msg.get("content") {
                            if let Some(text) = content.as_str() {
                                task_description = Some(text.to_string());
                            } else if let Some(arr) = content.as_array() {
                                // Content might be an array of blocks
                                for block in arr {
                                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                        task_description = Some(text.to_string());
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // Also check top-level "content" or "task" fields
                if task_description.is_none() {
                    task_description = parsed
                        .get("task")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                }
            }
        }

        // Parse last few lines for end time
        let tail_start = if all_lines.len() > 5 { all_lines.len() - 5 } else { 0 };
        for line in &all_lines[tail_start..] {
            let parsed: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(ts) = parsed.get("timestamp").and_then(|v| v.as_str()) {
                ended_at = Some(ts.to_string());
            }
        }

        subagents.push(json!({
            "agentId": agent_id,
            "slug": slug,
            "startedAt": started_at,
            "endedAt": ended_at,
            "lineCount": line_count,
            "taskDescription": task_description,
        }));
    }

    // Sort by start time (earliest first)
    subagents.sort_by(|a, b| {
        let a_ts = a.get("startedAt").and_then(|v| v.as_str()).unwrap_or("");
        let b_ts = b.get("startedAt").and_then(|v| v.as_str()).unwrap_or("");
        a_ts.cmp(b_ts)
    });

    Ok(json!({ "subagents": subagents }))
}

/// List or search sessions with optional filtering by project and text query.
#[tauri::command]
pub async fn list_sessions(
    db: State<'_, DbState>,
    query: Option<String>,
    project: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sessions = queries::list_sessions(
        &conn,
        query.as_deref(),
        project.as_deref(),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "sessions": sessions }))
}

/// Get a single session by ID together with all its messages.
#[tauri::command]
pub async fn get_session(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Fetch the session row by ID directly.
    let session_row = conn
        .query_row(
            "SELECT id, project_id, agent_type, jsonl_path, git_branch,
                    cwd, cli_version, first_message, last_message,
                    message_count, total_input_tokens, total_output_tokens,
                    model_used, slug, file_size_bytes, indexed_at, file_mtime,
                    cache_read_tokens, cache_creation_tokens,
                    compaction_count, estimated_cost_usd
             FROM cc_sessions WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(queries::SessionRow {
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
            },
        )
        .map_err(|e| e.to_string())?;

    let messages =
        queries::get_session_messages(&conn, &id).map_err(|e| e.to_string())?;

    Ok(json!({
        "session": session_row,
        "messages": messages,
    }))
}

/// Full-text search across all indexed messages using FTS5.
#[tauri::command]
pub async fn search_messages(
    db: State<'_, DbState>,
    query: String,
) -> Result<Value, String> {
    if query.trim().is_empty() {
        return Ok(json!({ "results": [] }));
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let results = queries::search_messages(&conn, &query).map_err(|e| e.to_string())?;
    Ok(json!({ "results": results }))
}

/// Merge multiple sessions into a single new session, copying all messages
/// and aggregating metadata. Source sessions are annotated with a reference
/// to the merged session.
#[tauri::command]
pub async fn merge_sessions(
    db: State<'_, DbState>,
    session_ids: Vec<String>,
    target_project_id: String,
    merged_name: Option<String>,
) -> Result<Value, String> {
    if session_ids.len() < 2 {
        return Err("At least 2 sessions are required for merging".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 1. Validate that all session_ids exist and collect their metadata
    let mut source_sessions: Vec<queries::SessionRow> = Vec::new();
    for sid in &session_ids {
        let session = conn
            .query_row(
                "SELECT id, project_id, agent_type, jsonl_path, git_branch,
                        cwd, cli_version, first_message, last_message,
                        message_count, total_input_tokens, total_output_tokens,
                        model_used, slug, file_size_bytes, indexed_at, file_mtime,
                        cache_read_tokens, cache_creation_tokens,
                        compaction_count, estimated_cost_usd
                 FROM cc_sessions WHERE id = ?1",
                rusqlite::params![sid],
                |row| {
                    Ok(queries::SessionRow {
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
                },
            )
            .map_err(|_| format!("Session not found: {}", sid))?;
        source_sessions.push(session);
    }

    // 2. Compute aggregates
    let total_message_count: i64 = source_sessions.iter().map(|s| s.message_count).sum();
    let total_input_tokens: i64 = source_sessions.iter().map(|s| s.total_input_tokens).sum();
    let total_output_tokens: i64 = source_sessions.iter().map(|s| s.total_output_tokens).sum();
    let total_cache_read: i64 = source_sessions.iter().map(|s| s.cache_read_tokens).sum();
    let total_cache_creation: i64 = source_sessions.iter().map(|s| s.cache_creation_tokens).sum();
    let total_compaction: i64 = source_sessions.iter().map(|s| s.compaction_count).sum();
    let total_cost: f64 = source_sessions.iter().map(|s| s.estimated_cost_usd).sum();
    let total_file_size: i64 = source_sessions.iter().map(|s| s.file_size_bytes).sum();

    // Earliest first_message and latest last_message
    let first_message = source_sessions
        .iter()
        .filter_map(|s| s.first_message.as_ref())
        .min()
        .cloned();
    let last_message = source_sessions
        .iter()
        .filter_map(|s| s.last_message.as_ref())
        .max()
        .cloned();

    // Use the first source session's metadata for agent_type, cwd, model, etc.
    let first = &source_sessions[0];

    // 3. Create the merged session
    let merged_id = uuid::Uuid::new_v4().to_string();
    let slug = merged_name.unwrap_or_else(|| "merged-session".to_string());
    let now = chrono::Utc::now().to_rfc3339();

    queries::upsert_session(
        &conn,
        &queries::SessionInput {
            id: merged_id.clone(),
            project_id: target_project_id,
            agent_type: Some(first.agent_type.clone()),
            jsonl_path: None, // Merged session has no single JSONL file
            git_branch: first.git_branch.clone(),
            cwd: first.cwd.clone(),
            cli_version: first.cli_version.clone(),
            first_message,
            last_message,
            message_count: Some(total_message_count),
            total_input_tokens: Some(total_input_tokens),
            total_output_tokens: Some(total_output_tokens),
            model_used: first.model_used.clone(),
            slug: Some(slug),
            file_size_bytes: Some(total_file_size),
            indexed_at: Some(now),
            file_mtime: None,
            cache_read_tokens: Some(total_cache_read),
            cache_creation_tokens: Some(total_cache_creation),
            compaction_count: Some(total_compaction),
            estimated_cost_usd: Some(total_cost),
        },
    )
    .map_err(|e| e.to_string())?;

    // 4. Copy all messages from source sessions into the merged session,
    //    preserving original timestamps and order. We assign new IDs to avoid
    //    conflicts and set the session_id to the merged session.
    for sid in &session_ids {
        let messages =
            queries::get_session_messages(&conn, sid).map_err(|e| e.to_string())?;
        for msg in &messages {
            let new_msg_id = uuid::Uuid::new_v4().to_string();
            queries::insert_message(
                &conn,
                &queries::MessageInput {
                    id: new_msg_id,
                    session_id: merged_id.clone(),
                    parent_uuid: msg.parent_uuid.clone(),
                    msg_type: msg.msg_type.clone(),
                    role: msg.role.clone(),
                    content_text: msg.content_text.clone(),
                    model: msg.model.clone(),
                    input_tokens: msg.input_tokens,
                    output_tokens: msg.output_tokens,
                    timestamp: msg.timestamp.clone(),
                    line_number: msg.line_number,
                    is_sidechain: Some(msg.is_sidechain),
                },
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // 5. Mark source sessions with a reference to the merged session
    let short_merged = &merged_id[..8];
    for sid in &session_ids {
        conn.execute(
            "UPDATE cc_sessions SET slug = COALESCE(slug, '') || ' [merged into ' || ?2 || ']' WHERE id = ?1",
            rusqlite::params![sid, short_merged],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(json!({ "merged_session_id": merged_id }))
}

/// Move all sessions from one or more source projects into a target project.
/// Updates session counts on both source and target projects.
#[tauri::command]
pub async fn merge_projects(
    db: State<'_, DbState>,
    source_project_ids: Vec<String>,
    target_project_id: String,
) -> Result<Value, String> {
    if source_project_ids.is_empty() {
        return Err("At least one source project is required".to_string());
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Verify target project exists
    let target_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM cc_projects WHERE id = ?1",
            rusqlite::params![target_project_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|e| e.to_string())?;

    if !target_exists {
        return Err(format!("Target project not found: {}", target_project_id));
    }

    let mut total_moved: i64 = 0;

    for source_id in &source_project_ids {
        if source_id == &target_project_id {
            continue; // Skip self-merge
        }

        // Count sessions being moved
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cc_sessions WHERE project_id = ?1",
                rusqlite::params![source_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        // Move sessions to the target project
        conn.execute(
            "UPDATE cc_sessions SET project_id = ?2 WHERE project_id = ?1",
            rusqlite::params![source_id, target_project_id],
        )
        .map_err(|e| e.to_string())?;

        // Update source project session count to 0
        conn.execute(
            "UPDATE cc_projects SET session_count = 0 WHERE id = ?1",
            rusqlite::params![source_id],
        )
        .map_err(|e| e.to_string())?;

        total_moved += count;
    }

    // Update target project session count
    let new_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cc_sessions WHERE project_id = ?1",
            rusqlite::params![target_project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE cc_projects SET session_count = ?2 WHERE id = ?1",
        rusqlite::params![target_project_id, new_count],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({ "moved_sessions": total_moved }))
}
