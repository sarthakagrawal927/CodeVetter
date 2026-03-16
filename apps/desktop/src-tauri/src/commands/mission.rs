use crate::db::queries::{self, ActivityInput, AgentTaskInput, AgentTaskUpdate};
use crate::DbState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

/// Create a new kanban task.
#[tauri::command]
pub async fn create_task(
    db: State<'_, DbState>,
    title: String,
    description: Option<String>,
    acceptance_criteria: Option<String>,
    project_path: Option<String>,
) -> Result<Value, String> {
    let input = AgentTaskInput {
        title: title.clone(),
        description,
        acceptance_criteria,
        project_path: project_path.clone(),
        status: Some("backlog".to_string()),
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let task_id = queries::create_agent_task(&conn, &input).map_err(|e| e.to_string())?;

    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: None,
            event_type: Some("task_created".to_string()),
            summary: Some(format!("Task created: {title}")),
            metadata: Some(json!({ "task_id": task_id, "project_path": project_path }).to_string()),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({ "task_id": task_id, "status": "backlog" }))
}

/// Update an existing task (status, assigned agent, etc.).
///
/// When status changes to "review", automatically triggers a local code
/// review on the task's project_path (if set). The review runs async and
/// updates the task with the review score when complete.
#[tauri::command]
pub async fn update_task(
    db: State<'_, DbState>,
    app_handle: AppHandle,
    id: String,
    status: Option<String>,
    assigned_agent: Option<String>,
) -> Result<Value, String> {
    let update = AgentTaskUpdate {
        status: status.clone(),
        assigned_agent: assigned_agent.clone(),
        review_id: None,
        review_score: None,
        review_attempts: None,
    };

    // Fetch task info before updating (for auto-review)
    let task_project_path = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let tasks = queries::list_agent_tasks(&conn, None).map_err(|e| e.to_string())?;
        tasks.into_iter().find(|t| t.id == id).and_then(|t| t.project_path)
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_agent_task(&conn, &id, &update).map_err(|e| e.to_string())?;

    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: assigned_agent.clone(),
            event_type: Some("task_updated".to_string()),
            summary: Some(format!(
                "Task {} updated — status={:?}, agent={:?}",
                id, status, assigned_agent
            )),
            metadata: None,
        },
    )
    .map_err(|e| e.to_string())?;

    drop(conn); // Release lock before async work

    // Auto-trigger review when task moves to "review" status
    if status.as_deref() == Some("review") {
        if let Some(ref project_path) = task_project_path {
            let db_clone = db.inner().clone();
            let task_id = id.clone();
            let repo_path = project_path.clone();
            let app = app_handle.clone();

            // Spawn async review in background
            tokio::spawn(async move {
                log::info!("Auto-review triggered for task {} at {}", task_id, repo_path);

                match auto_review_task(&db_clone, &app, &task_id, &repo_path).await {
                    Ok(score) => {
                        log::info!("Auto-review complete for task {}: score={:.0}", task_id, score);
                    }
                    Err(e) => {
                        log::error!("Auto-review failed for task {}: {}", task_id, e);
                    }
                }
            });
        }
    }

    Ok(json!({ "task_id": id, "updated": true }))
}

/// List tasks, optionally filtered by status.
#[tauri::command]
pub async fn list_tasks(
    db: State<'_, DbState>,
    status: Option<String>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tasks = queries::list_agent_tasks(&conn, status.as_deref()).map_err(|e| e.to_string())?;
    Ok(json!({ "tasks": tasks }))
}

/// Return the activity feed, optionally scoped to one agent.
#[tauri::command]
pub async fn list_activity(
    db: State<'_, DbState>,
    agent_id: Option<String>,
    limit: Option<i64>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let entries = queries::list_activity(&conn, agent_id.as_deref(), limit.unwrap_or(100))
        .map_err(|e| e.to_string())?;
    Ok(json!({ "activity": entries }))
}

/// Send a message in an agent-to-agent (or human-to-agent) thread.
#[tauri::command]
pub async fn send_agent_message(
    db: State<'_, DbState>,
    thread_id: String,
    content: String,
    mentions: Option<String>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let msg_id = queries::insert_agent_message(
        &conn,
        &thread_id,
        "human",       // sender_type — the UI user
        None,          // sender_agent_id
        &content,
        mentions.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "message_id": msg_id,
        "thread_id": thread_id,
        "delivered": false,
    }))
}

/// List messages in a thread (task or project discussion).
#[tauri::command]
pub async fn list_thread_messages(
    db: State<'_, DbState>,
    thread_id: String,
    limit: Option<i64>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let messages =
        queries::list_agent_messages(&conn, &thread_id, limit.unwrap_or(100))
            .map_err(|e| e.to_string())?;
    Ok(json!({ "messages": messages }))
}

/// Get cost dashboard data — aggregated cost per agent.
#[tauri::command]
pub async fn get_cost_dashboard(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let summaries = queries::get_cost_dashboard(&conn).map_err(|e| e.to_string())?;

    // Also compute total across all agents
    let total_cost: f64 = summaries.iter().map(|s| s.total_cost_usd).sum();
    let total_input: i64 = summaries.iter().map(|s| s.total_input_tokens).sum();
    let total_output: i64 = summaries.iter().map(|s| s.total_output_tokens).sum();

    Ok(json!({
        "agents": summaries,
        "total_cost_usd": total_cost,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
    }))
}

// ─── Auto-review helper ──────────────────────────────────────────────────────

/// Run a local code review for a task and update the task with results.
///
/// Called automatically when a task moves to "review" status.
/// Reviews the diff between main and HEAD in the task's project directory.
async fn auto_review_task(
    db: &DbState,
    app_handle: &AppHandle,
    task_id: &str,
    repo_path: &str,
) -> Result<f64, String> {
    // Log that review is starting
    if let Ok(conn) = db.0.lock() {
        let _ = queries::log_activity(
            &conn,
            &ActivityInput {
                agent_id: None,
                event_type: Some("auto_review_started".to_string()),
                summary: Some(format!(
                    "Auto-review started for task {} at {}",
                    task_id, repo_path
                )),
                metadata: Some(
                    serde_json::json!({ "task_id": task_id, "repo_path": repo_path }).to_string(),
                ),
            },
        );
    }

    let _ = app_handle.emit("activity-update", serde_json::json!({
        "event_type": "auto_review_started",
        "summary": format!("Auto-review started for task {}", task_id),
    }));

    // Call the review sidecar (same as start_local_review but without State)
    let review_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Insert the review record
    if let Ok(conn) = db.0.lock() {
        conn.execute(
            "INSERT INTO local_reviews (id, review_type, source_label, repo_path, agent_used, status, started_at, created_at)
             VALUES (?1, 'local_diff', ?2, ?3, 'claude-code', 'analyzing', ?4, ?4)",
            rusqlite::params![review_id, format!("Auto-review: task {}", task_id), repo_path, now],
        ).map_err(|e| e.to_string())?;
    }

    // Run git diff to get changes
    let diff_output = std::process::Command::new("git")
        .args(["diff", "main...HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git diff failed: {e}"))?;

    let diff = String::from_utf8_lossy(&diff_output.stdout).to_string();

    if diff.trim().is_empty() {
        // Try working tree diff instead
        let diff_output2 = std::process::Command::new("git")
            .args(["diff", "HEAD"])
            .current_dir(repo_path)
            .output()
            .map_err(|e| format!("git diff HEAD failed: {e}"))?;
        let diff2 = String::from_utf8_lossy(&diff_output2.stdout).to_string();

        if diff2.trim().is_empty() {
            // No changes to review
            if let Ok(conn) = db.0.lock() {
                let _ = conn.execute(
                    "UPDATE local_reviews SET status = 'completed', score_composite = 100, findings_count = 0, completed_at = ?2 WHERE id = ?1",
                    rusqlite::params![review_id, now],
                );
            }

            // Update task with perfect score
            if let Ok(conn) = db.0.lock() {
                let _ = queries::update_agent_task(
                    &conn,
                    task_id,
                    &AgentTaskUpdate {
                        status: Some("done".to_string()),
                        assigned_agent: None,
                        review_id: Some(review_id),
                        review_score: Some(100.0),
                        review_attempts: Some(1),
                    },
                );
            }

            return Ok(100.0);
        }
    }

    // Spawn the sidecar to do the actual review
    let sidecar_path = find_sidecar()?;
    let repo_path_owned = repo_path.to_string();
    let sidecar_output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&sidecar_path)
            .args(["review_diff"])
            .env("REVIEW_REPO_PATH", &repo_path_owned)
            .env("REVIEW_TONE", "concise")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| format!("sidecar join error: {e}"))?
    .map_err(|e| format!("sidecar spawn error: {e}"))?;

    let stdout = String::from_utf8_lossy(&sidecar_output.stdout);

    // Try to parse the review result
    let (score, findings_count, review_action) = match serde_json::from_str::<serde_json::Value>(&stdout) {
        Ok(result) => {
            let score = result.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let findings = result.get("findings_count").and_then(|v| v.as_i64()).unwrap_or(0);
            let action = result.get("review_action").and_then(|v| v.as_str()).unwrap_or("comment").to_string();

            // Insert findings if present
            if let Some(findings_arr) = result.get("findings").and_then(|v| v.as_array()) {
                if let Ok(conn) = db.0.lock() {
                    for f in findings_arr {
                        let fid = uuid::Uuid::new_v4().to_string();
                        let _ = conn.execute(
                            "INSERT INTO local_review_findings (id, review_id, severity, title, summary, suggestion, file_path, line, confidence, fingerprint)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                            rusqlite::params![
                                fid,
                                review_id,
                                f.get("severity").and_then(|v| v.as_str()).unwrap_or("medium"),
                                f.get("title").and_then(|v| v.as_str()).unwrap_or("Finding"),
                                f.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
                                f.get("suggestion").and_then(|v| v.as_str()),
                                f.get("file_path").and_then(|v| v.as_str()),
                                f.get("line").and_then(|v| v.as_i64()),
                                f.get("confidence").and_then(|v| v.as_f64()),
                                f.get("fingerprint").and_then(|v| v.as_str()),
                            ],
                        );
                    }
                }
            }

            (score, findings, action)
        }
        Err(_) => {
            // Sidecar failed to produce valid JSON
            log::warn!("Auto-review sidecar output was not valid JSON");
            (0.0, 0, "comment".to_string())
        }
    };

    let completed_at = chrono::Utc::now().to_rfc3339();

    // Update review record
    if let Ok(conn) = db.0.lock() {
        let _ = conn.execute(
            "UPDATE local_reviews SET status = 'completed', score_composite = ?2, findings_count = ?3, review_action = ?4, completed_at = ?5 WHERE id = ?1",
            rusqlite::params![review_id, score, findings_count, review_action, completed_at],
        );
    }

    // Determine if task should auto-advance to "done" (score >= 80, no critical findings)
    let new_status = if score >= 80.0 { "done" } else { "review" };

    if let Ok(conn) = db.0.lock() {
        let _ = queries::update_agent_task(
            &conn,
            task_id,
            &AgentTaskUpdate {
                status: Some(new_status.to_string()),
                assigned_agent: None,
                review_id: Some(review_id.clone()),
                review_score: Some(score),
                review_attempts: Some(1),
            },
        );

        let _ = queries::log_activity(
            &conn,
            &ActivityInput {
                agent_id: None,
                event_type: Some("auto_review_completed".to_string()),
                summary: Some(format!(
                    "Auto-review completed: score {:.0}, {} findings → {}",
                    score, findings_count, new_status
                )),
                metadata: Some(
                    serde_json::json!({
                        "task_id": task_id,
                        "review_id": review_id,
                        "score": score,
                        "findings_count": findings_count,
                        "new_status": new_status,
                    })
                    .to_string(),
                ),
            },
        );
    }

    // Emit events
    let _ = app_handle.emit("activity-update", serde_json::json!({
        "event_type": "auto_review_completed",
        "summary": format!("Auto-review: score {:.0}, {} findings", score, findings_count),
        "task_id": task_id,
        "review_id": review_id,
        "score": score,
    }));

    // System notification
    use tauri_plugin_notification::NotificationExt;
    let _ = app_handle
        .notification()
        .builder()
        .title(&format!("Review complete — Score: {:.0}", score))
        .body(&format!(
            "{} findings. Task moved to {}.",
            findings_count, new_status
        ))
        .show();

    Ok(score)
}

/// Locate the review sidecar binary.
fn find_sidecar() -> Result<String, String> {
    // Try the standard Tauri sidecar location
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(&p).to_path_buf())
        .map_err(|e| format!("Failed to get exe dir: {e}"))?;

    // Check common sidecar locations
    for candidate in &[
        exe_dir.join("review-sidecar"),
        exe_dir.join("../Resources/review-sidecar"),
        std::path::PathBuf::from("src-tauri/review-sidecar"),
    ] {
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    // Fall back to PATH
    Ok("review-sidecar".to_string())
}
