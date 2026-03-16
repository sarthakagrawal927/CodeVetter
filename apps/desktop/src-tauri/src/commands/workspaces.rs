use crate::db::queries::{self, WorkspaceRow};
use crate::DbState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn list_workspaces(
    db: State<'_, DbState>,
    status_filter: Option<String>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let workspaces =
        queries::list_workspaces(&conn, status_filter.as_deref()).map_err(|e| e.to_string())?;
    Ok(json!({ "workspaces": workspaces }))
}

#[tauri::command]
pub async fn create_workspace(
    db: State<'_, DbState>,
    name: String,
    repo_path: String,
    branch: String,
    pr_number: Option<i64>,
    pr_url: Option<String>,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Try to create the git branch if it doesn't already exist.
    // We silently ignore errors (branch may already exist, or repo_path may not be a git repo yet).
    let _ = std::process::Command::new("git")
        .args(["branch", &branch])
        .current_dir(&repo_path)
        .output();

    let workspace = WorkspaceRow {
        id: id.clone(),
        name,
        repo_path,
        branch,
        pr_number,
        pr_url,
        status: "in_progress".to_string(),
        session_id: None,
        created_at: now.clone(),
        updated_at: now,
        archived_at: None,
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_workspace(&conn, &workspace).map_err(|e| e.to_string())?;

    Ok(json!({ "id": id, "workspace": workspace }))
}

#[tauri::command]
pub async fn get_workspace(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let workspace = queries::get_workspace(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Workspace {id} not found"))?;
    Ok(json!({ "workspace": workspace }))
}

#[tauri::command]
pub async fn update_workspace(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    branch: Option<String>,
    status: Option<String>,
    session_id: Option<String>,
    pr_number: Option<i64>,
    pr_url: Option<String>,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_workspace(
        &conn,
        &id,
        name.as_deref(),
        branch.as_deref(),
        status.as_deref(),
        session_id.as_deref(),
        pr_number,
        pr_url.as_deref(),
        &now,
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub async fn archive_workspace(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::archive_workspace(&conn, &id, &now).map_err(|e| e.to_string())?;
    Ok(json!({ "archived": true }))
}

#[tauri::command]
pub async fn unarchive_workspace(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::unarchive_workspace(&conn, &id, &now).map_err(|e| e.to_string())?;
    Ok(json!({ "unarchived": true }))
}

#[tauri::command]
pub async fn delete_workspace(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_workspace(&conn, &id).map_err(|e| e.to_string())?;
    Ok(json!({ "deleted": true }))
}

#[tauri::command]
pub async fn get_workspace_git_status(
    id: String,
    db: State<'_, DbState>,
) -> Result<Value, String> {
    let repo_path = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let workspace = queries::get_workspace(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Workspace {id} not found"))?;
        workspace.repo_path
    };

    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git status: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let changed_files: usize = stdout.lines().filter(|l| !l.is_empty()).count();

    Ok(json!({
        "repo_path": repo_path,
        "changed_files": changed_files,
    }))
}
