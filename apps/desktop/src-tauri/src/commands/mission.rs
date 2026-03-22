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
/// When status changes to "review", emits an event so the frontend
/// can trigger a review via review-core in the webview.
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

    drop(conn);

    // Emit event when task moves to "review" — frontend handles the review via review-core
    if status.as_deref() == Some("review") {
        let _ = app_handle.emit("task-review-requested", json!({
            "task_id": id,
        }));
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
        "human",
        None,
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
