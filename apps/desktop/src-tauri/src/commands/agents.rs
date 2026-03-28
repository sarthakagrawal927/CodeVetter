use crate::adapters::claude_code::ClaudeCodeAdapter;
use crate::adapters::codex::CodexAdapter;
use crate::adapters::AgentAdapter;
use crate::coordination::{self, doc, schema, DocCache};
use crate::db::queries::{self, AgentProcessRow, ActivityInput};
use crate::DbState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{Emitter, State};

/// Launch a new agent process.
///
/// `adapter` must be one of `"claude-code"` or `"codex"`.
///
/// If `review_id` is provided, the agent's stdout is piped through the
/// coordination parser, which updates the shared CRDT review document
/// with file claims, findings, and status updates.
#[tauri::command]
pub async fn launch_agent(
    app: tauri::AppHandle,
    db: State<'_, DbState>,
    doc_cache: State<'_, DocCache>,
    adapter: String,
    project_path: String,
    role: Option<String>,
    task: Option<String>,
    review_id: Option<String>,
    resume_session_id: Option<String>,
) -> Result<Value, String> {
    // ── Concurrency check ─────────────────────────────────────────────────
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let running = queries::count_running_agents(&conn).unwrap_or(0);
        let max = queries::get_preference(&conn, "max_concurrent_agents")
            .ok()
            .flatten()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(3);
        if running >= max {
            return Err(format!(
                "Concurrency limit reached ({running}/{max} agents running). \
                 Wait for an agent to finish or increase the limit in Settings."
            ));
        }
    }

    let handle = match adapter.as_str() {
        "claude-code" => {
            let a = ClaudeCodeAdapter::new();
            a.launch(PathBuf::from(&project_path), role.clone(), task.clone(), resume_session_id.clone())
                .await?
        }
        "codex" => {
            let a = CodexAdapter::new();
            a.launch(PathBuf::from(&project_path), role.clone(), task.clone(), resume_session_id.clone())
                .await?
        }
        other => return Err(format!("Unknown adapter: {other}")),
    };

    let now = chrono::Utc::now().to_rfc3339();
    let display_name = format!(
        "{} ({})",
        adapter,
        role.as_deref().unwrap_or("default")
    );

    let agent_row = AgentProcessRow {
        id: handle.agent_id.clone(),
        agent_type: adapter.clone(),
        project_path: Some(project_path.clone()),
        session_id: None,
        pid: handle.pid.map(|p| p as i64),
        role: role.clone(),
        display_name: Some(display_name),
        status: "running".to_string(),
        total_input_tokens: 0,
        total_output_tokens: 0,
        estimated_cost_usd: 0.0,
        started_at: Some(now.clone()),
        stopped_at: None,
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::insert_agent_process(&conn, &agent_row).map_err(|e| e.to_string())?;

    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: Some(handle.agent_id.clone()),
            event_type: Some("agent_launched".to_string()),
            summary: Some(format!(
                "Launched {} agent at {}",
                adapter, project_path
            )),
            metadata: Some(
                json!({
                    "role": role,
                    "task": task,
                    "pid": handle.pid,
                    "review_id": review_id,
                })
                .to_string(),
            ),
        },
    )
    .map_err(|e| e.to_string())?;
    drop(conn); // Release lock before spawning the coordination thread

    // ── Coordination: if review_id is provided, spawn a background thread
    //    that reads the agent's stdout via /proc or a log file and pipes
    //    lines through the parser to update the CRDT doc. ──────────────────
    if let Some(ref rid) = review_id {
        let rid = rid.clone();
        let agent_id = handle.agent_id.clone();
        let project = project_path.clone();
        let cache = doc_cache.inner().clone();
        let app_handle = app.clone();
        let pid = handle.pid;

        // Spawn a background task to monitor the agent's stdout.
        // Since the adapters currently forget the child (and we can't easily
        // change the trait), we re-spawn a watcher that reads from the
        // agent's proc/fd or monitors the process state.
        //
        // For now, we set initial status and will rely on the explicit
        // Tauri commands (claim_file, add_finding, update_agent_status)
        // being called by the UI or future stdout piping.
        std::thread::Builder::new()
            .name(format!("coord-{}", &agent_id[..8]))
            .spawn(move || {
                // Set initial agent status in the review doc
                if let Err(e) = set_initial_agent_status(
                    &cache,
                    &rid,
                    &project,
                    &agent_id,
                    &app_handle,
                ) {
                    log::error!("Failed to set initial agent status: {e}");
                    return;
                }

                // Monitor the process — when it exits, mark the agent as done
                if let Some(pid) = pid {
                    monitor_agent_completion(
                        pid,
                        &cache,
                        &rid,
                        &project,
                        &agent_id,
                        &app_handle,
                    );
                }
            })
            .map_err(|e| format!("Failed to spawn coordination thread: {e}"))?;
    }

    Ok(json!({
        "agent_id": handle.agent_id,
        "adapter": adapter,
        "pid": handle.pid,
        "status": "running",
        "review_id": review_id,
    }))
}

/// Set the initial "reviewing" status for an agent in the CRDT doc.
fn set_initial_agent_status(
    cache: &DocCache,
    review_id: &str,
    repo_path: &str,
    agent_id: &str,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let mut docs = cache.lock().map_err(|e| format!("Lock: {e}"))?;
    coordination::cleanup_cache(&mut docs);
    let path = coordination::doc_path(repo_path, review_id);

    if !docs.contains_key(review_id) {
        let loaded = doc::load_from_disk(&path)?;
        docs.insert(review_id.to_string(), (loaded, std::time::Instant::now()));
    }

    let (am_doc, last_access) = docs
        .get_mut(review_id)
        .ok_or("Doc not in cache")?;

    *last_access = std::time::Instant::now();

    let status = schema::AgentStatus {
        status: "reviewing".to_string(),
        current_file: None,
        progress: 0.0,
    };
    doc::update_agent_status(am_doc, agent_id, &status);
    doc::save_to_disk(am_doc, &path)?;

    let state = doc::get_state(am_doc);
    let _ = app.emit(
        "review-state-changed",
        serde_json::to_value(&state).unwrap_or(json!({})),
    );

    Ok(())
}

/// Poll until the agent process exits, then mark it as done in the CRDT doc.
fn monitor_agent_completion(
    pid: u32,
    cache: &DocCache,
    review_id: &str,
    repo_path: &str,
    agent_id: &str,
    app: &tauri::AppHandle,
) {
    // Poll every 5 seconds to check if the process is still alive
    loop {
        std::thread::sleep(std::time::Duration::from_secs(5));

        let alive = {
            #[cfg(unix)]
            {
                unsafe { libc::kill(pid as i32, 0) == 0 }
            }
            #[cfg(not(unix))]
            {
                false
            }
        };

        if !alive {
            // Agent exited — mark as done
            if let Ok(mut docs) = cache.lock() {
                coordination::cleanup_cache(&mut docs);
                let path = coordination::doc_path(repo_path, review_id);

                if !docs.contains_key(review_id) {
                    if let Ok(loaded) = doc::load_from_disk(&path) {
                        docs.insert(review_id.to_string(), (loaded, std::time::Instant::now()));
                    }
                }

                if let Some((am_doc, last_access)) = docs.get_mut(review_id) {
                    *last_access = std::time::Instant::now();
                    let status = schema::AgentStatus {
                        status: "done".to_string(),
                        current_file: None,
                        progress: 1.0,
                    };
                    doc::update_agent_status(am_doc, agent_id, &status);
                    let _ = doc::save_to_disk(am_doc, &path);

                    let state = doc::get_state(am_doc);
                    let _ = app.emit(
                        "review-state-changed",
                        serde_json::to_value(&state).unwrap_or(json!({})),
                    );
                }
            }

            log::info!(
                "Coordination: agent {} (pid={}) completed for review {}",
                agent_id,
                pid,
                review_id
            );
            break;
        }
    }
}

/// Stop a running agent.
#[tauri::command]
pub async fn stop_agent(
    db: State<'_, DbState>,
    agent_id: String,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();

    // Look up the agent to determine its adapter type and pid.
    // We must extract what we need and drop the lock before any .await.
    let (agent_type, agent_pid, agent_project_path, agent_status) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let agent = queries::get_agent_process(&conn, &agent_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Agent {agent_id} not found"))?;
        (
            agent.agent_type.clone(),
            agent.pid,
            agent.project_path.unwrap_or_default(),
            agent.status.clone(),
        )
    }; // conn lock dropped here

    if agent_status == "stopped" {
        return Ok(json!({ "agent_id": agent_id, "status": "already_stopped" }));
    }

    // Attempt to kill the real OS process if we have a PID.
    if let Some(pid) = agent_pid {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
        let _ = pid; // suppress unused on non-unix
    }

    // Also call the adapter's stop method via a reconstructed handle.
    let handle = crate::adapters::AgentHandle {
        agent_id: agent_id.clone(),
        pid: agent_pid.map(|p| p as u32),
        project_path: PathBuf::from(agent_project_path),
        adapter_name: agent_type.clone(),
    };

    match agent_type.as_str() {
        "claude-code" => ClaudeCodeAdapter::new().stop(&handle).await?,
        "codex" => CodexAdapter::new().stop(&handle).await?,
        _ => {}
    }

    // Re-acquire the lock for the update (after async work is done).
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_agent_process_status(&conn, &agent_id, "stopped", Some(&now))
        .map_err(|e| e.to_string())?;

    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: Some(agent_id.clone()),
            event_type: Some("agent_stopped".to_string()),
            summary: Some(format!("Stopped agent {}", agent_id)),
            metadata: None,
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({ "agent_id": agent_id, "status": "stopped" }))
}

/// List all agent processes (running + stopped).
#[tauri::command]
pub async fn list_agents(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agents = queries::list_agent_processes(&conn).map_err(|e| e.to_string())?;
    Ok(json!({ "agents": agents }))
}

/// Detect running claude/codex processes not tracked by the app.
///
/// Runs `ps aux` and filters for claude and codex CLI processes, returning
/// info about each one (PID, command, agent type).
#[tauri::command]
pub async fn detect_running_agents() -> Result<Value, String> {
    let output = std::process::Command::new("ps")
        .args(["aux"])
        .output()
        .map_err(|e| format!("Failed to run ps: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut agents = Vec::new();

    for line in stdout.lines() {
        let lower = line.to_lowercase();
        // Match claude or codex CLI processes but skip grep, IDE plugins, etc.
        let is_claude = (lower.contains("/claude") || lower.contains("claude-code"))
            && !lower.contains("grep")
            && !lower.contains("code-reviewer") // skip our own app
            && !lower.contains("claude.ai");     // skip browser tabs
        let is_codex = lower.contains("/codex")
            && !lower.contains("grep")
            && !lower.contains("code-reviewer");

        if !is_claude && !is_codex {
            continue;
        }

        // Parse ps aux fields: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        let fields: Vec<&str> = line.splitn(11, |c: char| c.is_whitespace())
            .filter(|s| !s.is_empty())
            .collect();

        if fields.len() >= 11 {
            let agent_type = if is_codex { "codex" } else { "claude-code" };
            agents.push(json!({
                "pid": fields[1].parse::<u32>().unwrap_or(0),
                "cpu": fields[2],
                "mem": fields[3],
                "command": fields[10],
                "agent_type": agent_type,
            }));
        }
    }

    Ok(json!({ "running_agents": agents }))
}

/// Get details for a single agent, including accumulated cost.
#[tauri::command]
pub async fn get_agent(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agent = queries::get_agent_process(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Agent {id} not found"))?;

    // Aggregate cost from cost_log.
    let total_cost: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(cost_usd), 0.0) FROM agent_cost_log WHERE agent_id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "agent": agent,
        "total_cost_usd": total_cost,
    }))
}

// ─── Agent Personas ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPersona {
    pub id: String,
    pub name: String,
    pub department: String,
    pub description: String,
    pub color: String,
    pub tools: Vec<String>,
    pub system_prompt: String,
}

/// List all agent personas from `~/.claude/agents/`.
///
/// Each subdirectory is a department; each `.md` file within is a persona.
/// The YAML frontmatter (between `---` markers) is parsed for name,
/// description, color, and tools.  The body after frontmatter is the
/// system prompt.
#[tauri::command]
pub async fn list_agent_personas() -> Result<Value, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let agents_dir = PathBuf::from(&home).join(".claude").join("agents");

    if !agents_dir.exists() {
        return Ok(json!({ "personas": [] }));
    }

    let mut personas: Vec<AgentPersona> = Vec::new();

    let entries = std::fs::read_dir(&agents_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let dept_path = entry.path();
        if !dept_path.is_dir() {
            continue;
        }

        let department = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let md_entries = match std::fs::read_dir(&dept_path) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for md_entry in md_entries.flatten() {
            let file_path = md_entry.path();
            if file_path.extension().map(|e| e != "md").unwrap_or(true) {
                continue;
            }

            let id = file_path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let content = match std::fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            if let Some(persona) = parse_persona_md(&id, &department, &content) {
                personas.push(persona);
            }
        }
    }

    // Sort by department then by name for consistent ordering.
    personas.sort_by(|a, b| a.department.cmp(&b.department).then(a.name.cmp(&b.name)));

    Ok(json!({ "personas": personas }))
}

/// Create a new agent persona file at `~/.claude/agents/<department>/<id>.md`.
#[tauri::command]
pub async fn create_agent_persona(
    department: String,
    id: String,
    name: String,
    description: String,
    color: String,
    tools: String,
    system_prompt: String,
) -> Result<Value, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dept_dir = PathBuf::from(&home)
        .join(".claude")
        .join("agents")
        .join(&department);

    // Create department directory if it doesn't exist
    std::fs::create_dir_all(&dept_dir).map_err(|e| format!("Failed to create directory: {e}"))?;

    let file_path = dept_dir.join(format!("{}.md", id));
    let content = format!(
        "---\nname: {}\ndescription: {}\ncolor: {}\ntools: {}\n---\n\n{}",
        name, description, color, tools, system_prompt
    );

    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write persona file: {e}"))?;

    Ok(json!({ "success": true }))
}

/// Update an existing agent persona file at `~/.claude/agents/<department>/<id>.md`.
/// Only updates the provided fields; keeps existing values for None fields.
#[tauri::command]
pub async fn update_agent_persona(
    department: String,
    id: String,
    name: Option<String>,
    description: Option<String>,
    color: Option<String>,
    tools: Option<String>,
    system_prompt: Option<String>,
) -> Result<Value, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let file_path = PathBuf::from(&home)
        .join(".claude")
        .join("agents")
        .join(&department)
        .join(format!("{}.md", id));

    let existing_content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read persona file: {e}"))?;

    let existing = parse_persona_md(&id, &department, &existing_content)
        .ok_or_else(|| "Failed to parse existing persona file".to_string())?;

    let final_name = name.unwrap_or(existing.name);
    let final_description = description.unwrap_or(existing.description);
    let final_color = color.unwrap_or(existing.color);
    let final_tools = tools.unwrap_or_else(|| existing.tools.join(", "));
    let final_system_prompt = system_prompt.unwrap_or(existing.system_prompt);

    let content = format!(
        "---\nname: {}\ndescription: {}\ncolor: {}\ntools: {}\n---\n\n{}",
        final_name, final_description, final_color, final_tools, final_system_prompt
    );

    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write persona file: {e}"))?;

    Ok(json!({ "success": true }))
}

/// Delete an agent persona file at `~/.claude/agents/<department>/<id>.md`.
#[tauri::command]
pub async fn delete_agent_persona(
    department: String,
    id: String,
) -> Result<Value, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let file_path = PathBuf::from(&home)
        .join(".claude")
        .join("agents")
        .join(&department)
        .join(format!("{}.md", id));

    std::fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete persona file: {e}"))?;

    Ok(json!({ "success": true }))
}

/// Parse a persona `.md` file with YAML frontmatter.
fn parse_persona_md(id: &str, department: &str, content: &str) -> Option<AgentPersona> {
    let trimmed = content.trim();

    // Must start with `---`
    if !trimmed.starts_with("---") {
        return None;
    }

    // Find the closing `---`
    let after_first = &trimmed[3..];
    let closing_pos = after_first.find("\n---")?;
    let frontmatter = &after_first[..closing_pos];
    let body = after_first[closing_pos + 4..].trim().to_string();

    // Parse frontmatter fields manually (avoiding a full YAML dependency).
    let mut name = String::new();
    let mut description = String::new();
    let mut color = String::new();
    let mut tools: Vec<String> = Vec::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("name:") {
            name = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("color:") {
            color = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("tools:") {
            tools = val
                .split(',')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();
        }
    }

    if name.is_empty() {
        // Fallback: derive name from id
        name = id
            .split('-')
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().to_string() + c.as_str(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
    }

    Some(AgentPersona {
        id: id.to_string(),
        name,
        department: department.to_string(),
        description,
        color,
        tools,
        system_prompt: body,
    })
}
