use crate::coordination::{self, doc, schema::Finding, DocCache};
use serde_json::{json, Value};
use tauri::{Emitter, State};

/// Helper: load a doc from cache or disk, run an operation, save back, emit event.
fn with_doc<F, R>(
    cache: &DocCache,
    review_id: &str,
    repo_path: &str,
    app: Option<&tauri::AppHandle>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&mut automerge::AutoCommit) -> Result<R, String>,
{
    let mut docs = cache.lock().map_err(|e| format!("Lock error: {e}"))?;
    let path = coordination::doc_path(repo_path, review_id);

    // Load from cache, or from disk, or error
    if !docs.contains_key(review_id) {
        let loaded = doc::load_from_disk(&path)?;
        docs.insert(review_id.to_string(), loaded);
    }

    let am_doc = docs
        .get_mut(review_id)
        .ok_or_else(|| "Doc not in cache after load".to_string())?;

    let result = f(am_doc)?;

    // Save to disk
    doc::save_to_disk(am_doc, &path)?;

    // Emit event with full state
    if let Some(app) = app {
        let state = doc::get_state(am_doc);
        let _ = app.emit(
            "review-state-changed",
            serde_json::to_value(&state).unwrap_or(json!({})),
        );
    }

    Ok(result)
}

/// Create a new coordinated review document.
///
/// Initializes the Automerge doc, saves to disk, and returns the review_id.
#[tauri::command]
pub async fn create_review_doc(
    app: tauri::AppHandle,
    cache: State<'_, DocCache>,
    repo_path: String,
    branch: String,
) -> Result<Value, String> {
    let review_id = uuid::Uuid::new_v4().to_string();
    let path = coordination::doc_path(&repo_path, &review_id);

    let mut am_doc = doc::create_review_doc(&repo_path, &branch, &review_id);
    doc::save_to_disk(&mut am_doc, &path)?;

    // Cache it
    {
        let mut docs = cache.lock().map_err(|e| format!("Lock error: {e}"))?;
        docs.insert(review_id.clone(), am_doc);
    }

    // Read state for the event — need to re-acquire lock
    let state = {
        let docs = cache.lock().map_err(|e| format!("Lock error: {e}"))?;
        if let Some(d) = docs.get(&review_id) {
            doc::get_state(d)
        } else {
            return Err("Doc disappeared from cache".to_string());
        }
    };

    let _ = app.emit(
        "review-state-changed",
        serde_json::to_value(&state).unwrap_or(json!({})),
    );

    Ok(json!({ "review_id": review_id }))
}

/// Get the full state of a coordinated review.
#[tauri::command]
pub async fn get_review_state(
    cache: State<'_, DocCache>,
    review_id: String,
    repo_path: String,
) -> Result<Value, String> {
    let result = with_doc(&cache, &review_id, &repo_path, None, |am_doc| {
        let state = doc::get_state(am_doc);
        serde_json::to_value(&state).map_err(|e| format!("Serialize error: {e}"))
    })?;

    Ok(result)
}

/// Claim a file for an agent. Returns `{ "claimed": true/false }`.
#[tauri::command]
pub async fn claim_file(
    app: tauri::AppHandle,
    cache: State<'_, DocCache>,
    review_id: String,
    repo_path: String,
    agent_id: String,
    file: String,
) -> Result<Value, String> {
    let claimed = with_doc(
        &cache,
        &review_id,
        &repo_path,
        Some(&app),
        |am_doc| {
            Ok(doc::claim_file(am_doc, &agent_id, &file))
        },
    )?;

    Ok(json!({ "claimed": claimed }))
}

/// Add a finding to a coordinated review.
#[tauri::command]
pub async fn add_finding(
    app: tauri::AppHandle,
    cache: State<'_, DocCache>,
    review_id: String,
    repo_path: String,
    finding: Value,
) -> Result<Value, String> {
    let parsed_finding = Finding {
        id: uuid::Uuid::new_v4().to_string(),
        file: finding
            .get("file")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        line_start: finding
            .get("line_start")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        line_end: finding
            .get("line_end")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        severity: finding
            .get("severity")
            .and_then(|v| v.as_str())
            .unwrap_or("info")
            .to_string(),
        message: finding
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        agent_id: finding
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    with_doc(
        &cache,
        &review_id,
        &repo_path,
        Some(&app),
        |am_doc| {
            doc::add_finding(am_doc, &parsed_finding);
            Ok(())
        },
    )?;

    Ok(json!({ "ok": true }))
}

/// Update an agent's status within a coordinated review.
#[tauri::command]
pub async fn update_agent_status(
    app: tauri::AppHandle,
    cache: State<'_, DocCache>,
    review_id: String,
    repo_path: String,
    agent_id: String,
    status: Value,
) -> Result<Value, String> {
    let agent_status = crate::coordination::schema::AgentStatus {
        status: status
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        current_file: status
            .get("current_file")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        progress: status
            .get("progress")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
    };

    with_doc(
        &cache,
        &review_id,
        &repo_path,
        Some(&app),
        |am_doc| {
            doc::update_agent_status(am_doc, &agent_id, &agent_status);
            Ok(())
        },
    )?;

    Ok(json!({ "ok": true }))
}

/// Finalize a coordinated review — returns findings count and cleans up cache.
#[tauri::command]
pub async fn finalize_review(
    app: tauri::AppHandle,
    cache: State<'_, DocCache>,
    review_id: String,
    repo_path: String,
) -> Result<Value, String> {
    let findings_count = with_doc(
        &cache,
        &review_id,
        &repo_path,
        Some(&app),
        |am_doc| {
            let state = doc::get_state(am_doc);
            Ok(state.findings.len())
        },
    )?;

    // Remove from cache (doc is already saved to disk)
    {
        let mut docs = cache.lock().map_err(|e| format!("Lock error: {e}"))?;
        docs.remove(&review_id);
    }

    Ok(json!({ "findings_count": findings_count }))
}
