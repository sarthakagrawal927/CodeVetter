use crate::db::queries;
use crate::DbState;
use serde_json::{json, Value};
use std::io::{BufRead, Seek, SeekFrom};
use tauri::State;

// ─────────────────────────────────────────────────────────────────
// Public Tauri commands
// ─────────────────────────────────────────────────────────────────

/// Manually trigger a re-index of all Claude Code session files.
///
/// Walks `~/.claude/projects/` looking for JSONL session files, parses each
/// one with the real Claude Code JSONL format, and upserts project / session /
/// message rows into the database.
///
/// Supports **incremental indexing**: files whose mtime has not changed since
/// the last index are skipped entirely.  Files that have grown (append-only)
/// are read starting from the previously stored byte offset so that only new
/// lines are parsed.
/// Run the full index directly with a connection reference.
/// Used by the startup background thread.
pub fn run_full_index_with_conn(conn: &rusqlite::Connection) -> Result<String, String> {
    let (indexed_sessions, indexed_messages, skipped_sessions) = full_index_impl(conn)?;

    // Store the last indexed timestamp
    let now = chrono::Utc::now().to_rfc3339();
    let _ = queries::set_preference(conn, "last_indexed_at", &now);

    Ok(format!(
        "sessions={indexed_sessions}, messages={indexed_messages}, skipped={skipped_sessions}"
    ))
}

#[tauri::command]
pub async fn trigger_index(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = conn_lock(&db)?;
    let (indexed_sessions, indexed_messages, skipped_sessions) =
        full_index_impl(&conn).map_err(|e| e.to_string())?;

    // Store the last indexed timestamp
    let now = chrono::Utc::now().to_rfc3339();
    let _ = queries::set_preference(&conn, "last_indexed_at", &now);

    Ok(json!({
        "indexed_sessions": indexed_sessions,
        "indexed_messages": indexed_messages,
        "skipped_sessions": skipped_sessions,
        "projects_scanned": 0,
    }))
}

/// Shared implementation for the full indexer.
fn full_index_impl(conn: &rusqlite::Connection) -> Result<(u64, u64, u64), String> {
    let all_bases = resolve_all_claude_projects_dirs();

    let mut indexed_sessions = 0u64;
    let mut indexed_messages = 0u64;
    let mut skipped_sessions = 0u64;

    // Collect project directories from all Claude profile directories.
    let project_dirs: Vec<_> = all_bases
        .iter()
        .filter(|b| b.exists())
        .flat_map(|b| std::fs::read_dir(b).ok().into_iter())
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .collect();

    for project_entry in &project_dirs {
        let project_path = project_entry.path();
        let project_dir_name = project_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let display_name = resolve_project_display_name(&project_dir_name);
        let dir_path_str = project_path.to_string_lossy().to_string();

        // Re-use existing project ID if the dir_path already exists, otherwise
        // create a new one.  This avoids generating a fresh UUID on every
        // re-index which would orphan sessions.
        let project_id = queries::get_project_id_by_dir(&conn, &dir_path_str)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let now = chrono::Utc::now().to_rfc3339();

        queries::upsert_project(
            &conn,
            &queries::ProjectInput {
                id: project_id.clone(),
                display_name: display_name.clone(),
                dir_path: dir_path_str,
                session_count: None,
                last_activity: Some(now.clone()),
                created_at: now.clone(),
            },
        )
        .map_err(|e| e.to_string())?;

        // Look for JSONL files inside the project directory (recursively).
        let jsonl_files: Vec<_> = walkdir(&project_path, "jsonl");

        for jsonl_path in &jsonl_files {
            let jsonl_path_str = jsonl_path.to_string_lossy().to_string();

            // ── Incremental check ────────────────────────────────
            let file_meta = std::fs::metadata(jsonl_path).ok();
            let file_size = file_meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let file_mtime_str = file_meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

            let existing = queries::get_session_by_jsonl_path(&conn, &jsonl_path_str)
                .map_err(|e| e.to_string())?;

            // If the file mtime is unchanged AND the session already has
            // messages, skip it.  Sessions with 0 messages (from the quick
            // startup index) always need a full parse.
            if let Some(ref meta) = existing {
                if meta.file_mtime.as_deref() == file_mtime_str.as_deref()
                    && meta.message_count > 0
                {
                    skipped_sessions += 1;
                    continue;
                }
            }

            // Determine byte offset for incremental reading.  If the file has
            // grown (append-only) AND the session already has messages, seek
            // to the old size and only parse new lines.  Sessions with 0
            // messages need a full read from the start.
            let byte_offset: u64 = match &existing {
                Some(meta)
                    if meta.file_size_bytes > 0
                        && file_size >= meta.file_size_bytes
                        && meta.message_count > 0 =>
                {
                    meta.file_size_bytes as u64
                }
                _ => 0,
            };

            // ── Parse the JSONL ──────────────────────────────────
            let file = match std::fs::File::open(jsonl_path) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let mut reader = std::io::BufReader::new(file);

            // We need session-level metadata from existing records when doing
            // incremental reads.  For a full read we extract them from the
            // first message.
            let mut session_id: Option<String> = existing.as_ref().map(|m| m.id.clone());
            let mut session_version: Option<String> = None;
            let mut session_git_branch: Option<String> = None;
            let mut session_cwd: Option<String> = None;
            let mut session_slug: Option<String> = None;
            let mut model_used: Option<String> = None;

            let mut msg_count: i64 = existing.as_ref().map(|m| m.message_count).unwrap_or(0);
            let mut total_input: i64 = existing
                .as_ref()
                .map(|m| m.total_input_tokens)
                .unwrap_or(0);
            let mut total_output: i64 = existing
                .as_ref()
                .map(|m| m.total_output_tokens)
                .unwrap_or(0);
            let mut total_cache_read: i64 = existing
                .as_ref()
                .map(|m| m.cache_read_tokens)
                .unwrap_or(0);
            let mut total_cache_creation: i64 = existing
                .as_ref()
                .map(|m| m.cache_creation_tokens)
                .unwrap_or(0);
            let mut compaction_count: i64 = existing
                .as_ref()
                .map(|m| m.compaction_count)
                .unwrap_or(0);

            let mut first_message: Option<String> = None;
            let mut last_message: Option<String> = None;

            // If doing a full re-read (offset == 0) we need the first message
            // timestamp.  For incremental we keep whatever is in the DB.
            let is_incremental = byte_offset > 0;

            if !is_incremental {
                // Full read: reset accumulators.
                msg_count = 0;
                total_input = 0;
                total_output = 0;
                total_cache_read = 0;
                total_cache_creation = 0;
                compaction_count = 0;
            }

            // Seek to the byte offset for incremental reading.
            if byte_offset > 0 {
                if reader.seek(SeekFrom::Start(byte_offset)).is_err() {
                    continue;
                }
            }

            // Track the line number relative to the whole file.  For
            // incremental reads we estimate the starting line from the
            // existing message count.
            let mut line_number: i64 = if is_incremental { msg_count } else { 0 };
            let mut new_messages = 0u64;

            let mut line_buf = String::new();
            loop {
                line_buf.clear();
                match reader.read_line(&mut line_buf) {
                    Ok(0) => break, // EOF
                    Ok(_) => {}
                    Err(_) => break,
                }

                let line = line_buf.trim();
                if line.is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => {
                        line_number += 1;
                        continue;
                    }
                };

                // ── Skip non-indexable types ─────────────────────
                let msg_type = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if msg_type == "progress" || msg_type == "file-history-snapshot" {
                    line_number += 1;
                    continue;
                }

                // ── Track compaction events ─────────────────────
                if msg_type == "summary" {
                    compaction_count += 1;
                }
                if parsed.get("autoCompact").and_then(|v| v.as_bool()).unwrap_or(false)
                    || parsed.get("isCompacted").and_then(|v| v.as_bool()).unwrap_or(false)
                {
                    compaction_count += 1;
                }

                // ── Extract session-level metadata from first msg ─
                if session_id.is_none() {
                    session_id = parsed
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                // Fall back to generating a UUID if no sessionId in file.
                if session_id.is_none() {
                    session_id = Some(uuid::Uuid::new_v4().to_string());
                }

                if session_version.is_none() {
                    session_version = parsed
                        .get("version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if session_git_branch.is_none() {
                    session_git_branch = parsed
                        .get("gitBranch")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if session_cwd.is_none() {
                    session_cwd = parsed
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if session_slug.is_none() {
                    session_slug = parsed
                        .get("slug")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }

                // ── Message UUID ─────────────────────────────────
                let msg_id = parsed
                    .get("uuid")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                // ── Role ─────────────────────────────────────────
                let role = parsed
                    .get("message")
                    .and_then(|m| m.get("role"))
                    .and_then(|v| v.as_str())
                    .map(String::from);

                // ── Timestamp ────────────────────────────────────
                let ts = parsed
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                if first_message.is_none() {
                    first_message = ts.clone();
                }
                last_message = ts.clone();

                // ── isSidechain ──────────────────────────────────
                let is_sidechain = parsed
                    .get("isSidechain")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                // ── parentUuid ───────────────────────────────────
                let parent_uuid = parsed
                    .get("parentUuid")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                // ── Content text extraction ───────────────────────
                let content_text = extract_content_text(&parsed);

                // ── Token usage ──────────────────────────────────
                let usage = parsed
                    .get("message")
                    .and_then(|m| m.get("usage"));

                let input_tokens = usage
                    .and_then(|u| u.get("input_tokens"))
                    .and_then(|v| v.as_i64());
                let cache_creation = usage
                    .and_then(|u| u.get("cache_creation_input_tokens"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let cache_read = usage
                    .and_then(|u| u.get("cache_read_input_tokens"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let output_tokens = usage
                    .and_then(|u| u.get("output_tokens"))
                    .and_then(|v| v.as_i64());

                // Total input includes cache tokens for accurate billing.
                let effective_input = input_tokens
                    .map(|it| it + cache_creation + cache_read);

                if let Some(it) = effective_input {
                    total_input += it;
                }
                if let Some(ot) = output_tokens {
                    total_output += ot;
                }
                total_cache_read += cache_read;
                total_cache_creation += cache_creation;

                // ── Model ────────────────────────────────────────
                if let Some(m) = parsed
                    .get("message")
                    .and_then(|msg| msg.get("model"))
                    .and_then(|v| v.as_str())
                {
                    model_used = Some(m.to_string());
                }

                // ── Slug (can appear on any message) ─────────────
                if let Some(s) = parsed.get("slug").and_then(|v| v.as_str()) {
                    session_slug = Some(s.to_string());
                }

                // ── Insert message into DB ───────────────────────
                let sid = session_id.as_deref().unwrap_or("");
                queries::insert_message(
                    &conn,
                    &queries::MessageInput {
                        id: msg_id,
                        session_id: sid.to_string(),
                        parent_uuid,
                        msg_type: Some(msg_type.to_string()),
                        role,
                        content_text,
                        model: model_used.clone(),
                        input_tokens: effective_input,
                        output_tokens,
                        timestamp: ts,
                        line_number: Some(line_number),
                        is_sidechain: Some(if is_sidechain { 1 } else { 0 }),
                    },
                )
                .map_err(|e| e.to_string())?;

                msg_count += 1;
                new_messages += 1;
                line_number += 1;
            }

            // ── Upsert session ───────────────────────────────────
            let sid = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            let estimated_cost = estimate_cost(
                model_used.as_deref().unwrap_or(""),
                total_input,
                total_output,
                total_cache_read,
                total_cache_creation,
            );

            queries::upsert_session(
                &conn,
                &queries::SessionInput {
                    id: sid,
                    project_id: project_id.clone(),
                    agent_type: Some("claude-code".to_string()),
                    jsonl_path: Some(jsonl_path_str),
                    git_branch: session_git_branch,
                    cwd: session_cwd,
                    cli_version: session_version,
                    first_message,
                    last_message,
                    message_count: Some(msg_count),
                    total_input_tokens: Some(total_input),
                    total_output_tokens: Some(total_output),
                    model_used,
                    slug: session_slug,
                    file_size_bytes: Some(file_size),
                    indexed_at: Some(now.clone()),
                    file_mtime: file_mtime_str,
                    cache_read_tokens: Some(total_cache_read),
                    cache_creation_tokens: Some(total_cache_creation),
                    compaction_count: Some(compaction_count),
                    estimated_cost_usd: Some(estimated_cost),
                },
            )
            .map_err(|e| e.to_string())?;

            indexed_sessions += 1;
            indexed_messages += new_messages;
        }

        // Update project session count.
        let session_count = jsonl_files.len() as i64;
        conn.execute(
            "UPDATE cc_projects SET session_count = ?2 WHERE id = ?1",
            rusqlite::params![project_id, session_count],
        )
        .map_err(|e: rusqlite::Error| e.to_string())?;

        // Update display name from session cwd if available (more reliable
        // than decoding the encoded directory name).
        let cwd_name: Option<String> = conn
            .query_row(
                "SELECT cwd FROM cc_sessions WHERE project_id = ?1 AND cwd IS NOT NULL AND cwd != '' LIMIT 1",
                rusqlite::params![project_id],
                |row| row.get::<_, String>(0),
            )
            .ok();

        if let Some(ref cwd) = cwd_name {
            let better_name = std::path::Path::new(cwd)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| display_name.clone());
            let _ = conn.execute(
                "UPDATE cc_projects SET display_name = ?2 WHERE id = ?1",
                rusqlite::params![project_id, better_name],
            );
        }
    }

    // ── Phase 2: Scan Codex sessions ─────────────────────────
    let codex_base = resolve_codex_sessions_dir();
    let mut codex_indexed = 0u64;
    let mut codex_messages = 0u64;

    if codex_base.exists() {
        let codex_files: Vec<_> = walkdir(&codex_base, "jsonl");

        for jsonl_path in &codex_files {
            let jsonl_path_str = jsonl_path.to_string_lossy().to_string();

            // ── Incremental check ────────────────────────────
            let file_meta = std::fs::metadata(jsonl_path).ok();
            let file_mtime_str = file_meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

            let existing = queries::get_session_by_jsonl_path(&conn, &jsonl_path_str)
                .map_err(|e| e.to_string())?;

            if let Some(ref meta) = existing {
                if meta.file_mtime.as_deref() == file_mtime_str.as_deref()
                    && meta.message_count > 0
                {
                    skipped_sessions += 1;
                    continue;
                }
            }

            // Read the first line to get session_meta and determine the project
            let first_line = match std::fs::File::open(jsonl_path) {
                Ok(f) => {
                    let mut rdr = std::io::BufReader::new(f);
                    let mut buf = String::new();
                    let _ = rdr.read_line(&mut buf);
                    buf
                }
                Err(_) => continue,
            };

            let meta_parsed: Value = match serde_json::from_str(first_line.trim()) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let meta_type = meta_parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if meta_type != "session_meta" {
                continue;
            }

            let payload = match meta_parsed.get("payload") {
                Some(p) => p,
                None => continue,
            };

            let codex_cwd = payload.get("cwd").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if codex_cwd.is_empty() {
                continue;
            }

            let now = chrono::Utc::now().to_rfc3339();

            // Resolve or create the project for this Codex session's cwd
            let project_id = queries::get_project_id_by_dir(&conn, &codex_cwd)
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| {
                    let pid = uuid::Uuid::new_v4().to_string();
                    let display = std::path::Path::new(&codex_cwd)
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| codex_cwd.clone());
                    let _ = queries::upsert_project(
                        &conn,
                        &queries::ProjectInput {
                            id: pid.clone(),
                            display_name: display,
                            dir_path: codex_cwd.clone(),
                            session_count: None,
                            last_activity: Some(now.clone()),
                            created_at: now.clone(),
                        },
                    );
                    pid
                });

            match parse_codex_session(jsonl_path, &conn, &project_id, &now) {
                Ok((sess, msgs)) => {
                    codex_indexed += sess;
                    codex_messages += msgs;
                }
                Err(_) => continue,
            }
        }
    }

    indexed_sessions += codex_indexed;
    indexed_messages += codex_messages;

    Ok((indexed_sessions, indexed_messages, skipped_sessions))
}

/// Return aggregate stats about the indexed data.
#[tauri::command]
pub async fn get_index_stats(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = conn_lock(&db)?;
    let stats = queries::get_index_stats(&conn).map_err(|e| e.to_string())?;
    let last_indexed_at = queries::get_preference(&conn, "last_indexed_at")
        .map_err(|e| e.to_string())?;
    let mut result = json!(stats);
    result["last_indexed_at"] = json!(last_indexed_at);
    Ok(result)
}

// ─────────────────────────────────────────────────────────────────
// Content text extraction
// ─────────────────────────────────────────────────────────────────

/// Extract a human-readable text representation from a JSONL message.
///
/// - **user messages** with string `message.content`: use directly.
/// - **user messages** with array `message.content` containing `tool_result`
///   blocks: produce a summary like `[tool_result for toolu_...]`.
/// - **assistant messages** with array `message.content`: concatenate all
///   `text` blocks, skipping `thinking` blocks.
/// - **tool_result user messages** (top-level `toolUseResult`): summarise.
fn extract_content_text(parsed: &Value) -> Option<String> {
    let message = parsed.get("message")?;
    let content = message.get("content")?;
    let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("");

    // String content (common for user messages).
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    // Array content.
    if let Some(blocks) = content.as_array() {
        match role {
            "assistant" => {
                // Concatenate text blocks, skip thinking blocks.
                let texts: Vec<&str> = blocks
                    .iter()
                    .filter_map(|block| {
                        let block_type = block.get("type")?.as_str()?;
                        if block_type == "text" {
                            block.get("text")?.as_str()
                        } else {
                            None
                        }
                    })
                    .collect();

                if texts.is_empty() {
                    // If no text blocks, check for tool_use blocks and
                    // produce a summary so the message is not blank.
                    let tool_names: Vec<&str> = blocks
                        .iter()
                        .filter_map(|block| {
                            let bt = block.get("type")?.as_str()?;
                            if bt == "tool_use" {
                                block.get("name")?.as_str()
                            } else {
                                None
                            }
                        })
                        .collect();
                    if tool_names.is_empty() {
                        None
                    } else {
                        Some(format!("[tool_use: {}]", tool_names.join(", ")))
                    }
                } else {
                    Some(texts.join("\n\n"))
                }
            }
            "user" => {
                // User array content is typically tool_result blocks.
                let summaries: Vec<String> = blocks
                    .iter()
                    .filter_map(|block| {
                        let block_type = block.get("type")?.as_str()?;
                        if block_type == "tool_result" {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown");
                            Some(format!("[tool_result for {tool_use_id}]"))
                        } else if block_type == "text" {
                            block.get("text").and_then(|v| v.as_str()).map(String::from)
                        } else {
                            None
                        }
                    })
                    .collect();

                if summaries.is_empty() {
                    None
                } else {
                    Some(summaries.join("\n"))
                }
            }
            _ => {
                // Unknown role with array content -- store raw JSON.
                Some(content.to_string())
            }
        }
    } else {
        // Content is some other JSON value (object, number, etc.).
        Some(content.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────
// Project name resolution
// ─────────────────────────────────────────────────────────────────

/// Convert a Claude Code project directory name like
/// `-Users-sarthakagrawal-Desktop-code-reviewer` into a human-friendly
/// display name.
///
/// Strategy: use the known home directory to strip the encoded prefix, then
/// greedily match intermediate path segments by checking which sub-segments
/// correspond to real directories on disk.  Everything after the last matched
/// directory is the project name (preserving real hyphens).
///
/// Example: `-Users-sarthakagrawal-Desktop-code-reviewer`
///   home = `/Users/sarthakagrawal`  →  encoded = `Users-sarthakagrawal`
///   remainder = `Desktop-code-reviewer`
///   `~/Desktop` is a dir → consume  →  project name = `code-reviewer`
fn resolve_project_display_name(dir_name: &str) -> String {
    let trimmed = dir_name.trim_start_matches('-');
    if trimmed.is_empty() {
        return dir_name.to_string();
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    if !home.is_empty() {
        // Encode the home path the same way Claude Code encodes directory names
        let home_encoded = home.trim_start_matches('/').replace('/', "-");

        if let Some(remainder) = trimmed.strip_prefix(&home_encoded) {
            let remainder = remainder.trim_start_matches('-');
            if remainder.is_empty() {
                return dir_name.to_string();
            }

            // Greedily match intermediate path segments from the home dir.
            // e.g., remainder = "Desktop-code-reviewer"
            // Check: is ~/Desktop a dir? Yes → consume.  Is ~/Desktop/code a
            // dir? No → "code-reviewer" is the project name.
            let parts: Vec<&str> = remainder.split('-').collect();
            let mut current_dir = std::path::PathBuf::from(&home);
            let mut consumed = 0usize;

            for start in 0..parts.len() {
                let candidate = parts[start];
                let test_path = current_dir.join(candidate);
                // Only consume this segment as a directory if there are more
                // segments after it (the last segment must be part of the
                // project name).
                if test_path.is_dir() && start + 1 < parts.len() {
                    current_dir = test_path;
                    consumed = start + 1;
                } else {
                    break;
                }
            }

            let project_name = parts[consumed..].join("-");
            if !project_name.is_empty() {
                return project_name;
            }
        }
    }

    // Fallback: replace `-` with `/` and take last component
    let reconstructed = trimmed.replace('-', "/");
    std::path::Path::new(&reconstructed)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_name.to_string())
}

// ─────────────────────────────────────────────────────────────────
// Cost estimation
// ─────────────────────────────────────────────────────────────────

fn estimate_cost(model: &str, total_input: i64, output_tokens: i64, cache_read: i64, cache_creation: i64) -> f64 {
    // Per-million-token pricing (approximate as of early 2026)
    let (input_price, output_price, cache_read_price, cache_write_price) = match model {
        m if m.contains("opus") => (15.0, 75.0, 1.5, 18.75),
        m if m.contains("sonnet") => (3.0, 15.0, 0.3, 3.75),
        m if m.contains("haiku") => (0.25, 1.25, 0.025, 0.3),
        m if m.contains("gpt-4o") => (2.5, 10.0, 1.25, 2.5),
        m if m.contains("gpt-4.1") => (2.0, 8.0, 0.5, 2.0),
        m if m.contains("o3") || m.contains("o4-mini") => (1.1, 4.4, 0.275, 1.1),
        _ => (3.0, 15.0, 0.3, 3.75), // default to sonnet pricing
    };

    // total_input already includes cache_read + cache_creation tokens (added
    // during indexing), so subtract them to get the base input token count
    // that is billed at the full input rate.
    let base_input = (total_input - cache_read - cache_creation).max(0);

    let cost = (base_input as f64 * input_price
        + output_tokens as f64 * output_price
        + cache_read as f64 * cache_read_price
        + cache_creation as f64 * cache_write_price) / 1_000_000.0;
    (cost * 100.0).round() / 100.0 // round to cents
}

// ─────────────────────────────────────────────────────────────────
// Codex session parsing
// ─────────────────────────────────────────────────────────────────

fn resolve_codex_sessions_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home)
        .join(".codex")
        .join("sessions")
}

/// Parse a Codex JSONL session file and upsert the session + messages.
/// Returns (sessions_indexed, messages_indexed).
fn parse_codex_session(
    jsonl_path: &std::path::Path,
    conn: &rusqlite::Connection,
    project_id: &str,
    now: &str,
) -> Result<(u64, u64), String> {
    let jsonl_path_str = jsonl_path.to_string_lossy().to_string();
    let file_meta = std::fs::metadata(jsonl_path).ok();
    let file_size = file_meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
    let file_mtime_str = file_meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

    let file = std::fs::File::open(jsonl_path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut session_cwd: Option<String> = None;
    let mut session_version: Option<String> = None;
    let mut session_git_branch: Option<String> = None;
    let mut model_used: Option<String> = None;

    let mut msg_count: i64 = 0;
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut total_cache_read: i64 = 0;
    let mut total_cache_creation: i64 = 0;
    let mut first_message: Option<String> = None;
    let mut last_message: Option<String> = None;
    let mut new_messages: u64 = 0;
    let mut line_number: i64 = 0;

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim().to_string();
        if line.is_empty() {
            line_number += 1;
            continue;
        }

        let parsed: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                line_number += 1;
                continue;
            }
        };

        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = parsed.get("payload");

        if msg_type == "session_meta" {
            if let Some(p) = payload {
                session_id = p.get("id").and_then(|v| v.as_str()).map(String::from);
                session_cwd = p.get("cwd").and_then(|v| v.as_str()).map(String::from);
                session_version = p.get("cli_version").and_then(|v| v.as_str()).map(String::from);
                session_git_branch = p.get("git")
                    .and_then(|g| g.get("branch"))
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if let Some(m) = p.get("model").and_then(|v| v.as_str()) {
                    model_used = Some(m.to_string());
                } else if let Some(mp) = p.get("model_provider").and_then(|v| v.as_str()) {
                    // Codex doesn't specify a model name; use a reasonable default
                    model_used = Some(if mp == "openai" { "o3".to_string() } else { mp.to_string() });
                }
            }
            line_number += 1;
            continue;
        }

        // ── Extract token counts from event_msg.token_count ──────────
        // Codex stores cumulative token usage in event_msg with type "token_count"
        // under payload.info.total_token_usage. We take the last one seen.
        if msg_type == "event_msg" {
            if let Some(p) = payload {
                let sub_type = p.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if sub_type == "token_count" {
                    if let Some(info) = p.get("info") {
                        if let Some(total_usage) = info.get("total_token_usage") {
                            // These are cumulative — always take the latest value
                            let input_t = total_usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                            let output_t = total_usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                            let cached = total_usage.get("cached_input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                            total_input = input_t;
                            total_output = output_t;
                            total_cache_read = cached;
                        }
                    }
                }
            }
        }

        if msg_type == "response_item" {
            if let Some(p) = payload {
                let role = p.get("role").and_then(|v| v.as_str()).map(String::from);

                // Extract content text from content array
                let content_text = p.get("content").and_then(|c| {
                    if let Some(arr) = c.as_array() {
                        let texts: Vec<&str> = arr.iter().filter_map(|block| {
                            let bt = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if bt == "output_text" || bt == "text" || bt == "input_text" {
                                block.get("text").and_then(|v| v.as_str())
                            } else {
                                None
                            }
                        }).collect();
                        if texts.is_empty() { None } else { Some(texts.join("\n\n")) }
                    } else if let Some(s) = c.as_str() {
                        Some(s.to_string())
                    } else {
                        None
                    }
                });

                // Extract token usage from response_item.payload.usage (if present)
                if let Some(usage) = p.get("usage") {
                    let input_t = usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                    let output_t = usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                    // Only use additive if no token_count events are providing cumulative totals
                    if total_input == 0 && total_output == 0 {
                        total_input += input_t;
                        total_output += output_t;
                    }
                }

                // Timestamp
                let ts = parsed.get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if first_message.is_none() {
                    first_message = ts.clone();
                }
                last_message = ts.clone();

                let msg_id = uuid::Uuid::new_v4().to_string();
                let sid = session_id.as_deref().unwrap_or("");

                let _ = queries::insert_message(
                    conn,
                    &queries::MessageInput {
                        id: msg_id,
                        session_id: sid.to_string(),
                        parent_uuid: None,
                        msg_type: Some("response_item".to_string()),
                        role,
                        content_text,
                        model: model_used.clone(),
                        input_tokens: None,
                        output_tokens: None,
                        timestamp: ts,
                        line_number: Some(line_number),
                        is_sidechain: Some(0),
                    },
                );

                msg_count += 1;
                new_messages += 1;
            }
        }

        line_number += 1;
    }

    // If we didn't get a session_id from the file, generate one
    let sid = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let estimated_cost = estimate_cost(
        model_used.as_deref().unwrap_or(""),
        total_input,
        total_output,
        total_cache_read,
        total_cache_creation,
    );

    queries::upsert_session(
        conn,
        &queries::SessionInput {
            id: sid,
            project_id: project_id.to_string(),
            agent_type: Some("codex".to_string()),
            jsonl_path: Some(jsonl_path_str),
            git_branch: session_git_branch,
            cwd: session_cwd,
            cli_version: session_version,
            first_message,
            last_message,
            message_count: Some(msg_count),
            total_input_tokens: Some(total_input),
            total_output_tokens: Some(total_output),
            model_used,
            slug: None,
            file_size_bytes: Some(file_size),
            indexed_at: Some(now.to_string()),
            file_mtime: file_mtime_str,
            cache_read_tokens: Some(total_cache_read),
            cache_creation_tokens: Some(total_cache_creation),
            compaction_count: Some(0),
            estimated_cost_usd: Some(estimated_cost),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok((1, new_messages))
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

fn conn_lock<'a>(
    db: &'a State<'a, DbState>,
) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    db.0.lock().map_err(|e| e.to_string())
}

/// Collect all Claude profile project directories.
/// Scans for ~/.claude/projects/ and any ~/.claude-*/projects/ directories.
fn resolve_all_claude_projects_dirs() -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let home_path = std::path::PathBuf::from(&home);
    let mut dirs = Vec::new();

    // Primary: ~/.claude/projects/
    dirs.push(home_path.join(".claude").join("projects"));

    // Additional profiles: ~/.claude-*/projects/
    if let Ok(entries) = std::fs::read_dir(&home_path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with(".claude-") && entry.path().is_dir() {
                let projects_dir = entry.path().join("projects");
                if projects_dir.exists() {
                    dirs.push(projects_dir);
                }
            }
        }
    }

    dirs
}

/// Recursively collect files with the given extension.
fn walkdir(dir: &std::path::Path, ext: &str) -> Vec<std::path::PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(walkdir(&path, ext));
            } else if path.extension().map(|e| e == ext).unwrap_or(false) {
                results.push(path);
            }
        }
    }
    results
}
