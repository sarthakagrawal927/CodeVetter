use crate::db::queries::{self, ChatTabRow};
use crate::DbState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn list_chat_tabs(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let tabs = queries::list_chat_tabs(&conn).map_err(|e| e.to_string())?;
    Ok(json!({ "tabs": tabs }))
}

#[tauri::command]
pub async fn create_chat_tab(
    db: State<'_, DbState>,
    title: Option<String>,
    project_path: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let position = queries::next_chat_tab_position(&conn).map_err(|e| e.to_string())?;

    let tab = ChatTabRow {
        id: id.clone(),
        title: title.unwrap_or_else(|| "Untitled".to_string()),
        session_id: None,
        project_path,
        model: model.unwrap_or_else(|| "sonnet".to_string()),
        position,
        created_at: now.clone(),
        updated_at: now,
    };

    queries::create_chat_tab(&conn, &tab).map_err(|e| e.to_string())?;

    Ok(json!(tab))
}

#[tauri::command]
pub async fn update_chat_tab(
    db: State<'_, DbState>,
    id: String,
    title: Option<String>,
    session_id: Option<String>,
    model: Option<String>,
    project_path: Option<String>,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_chat_tab(
        &conn,
        &id,
        title.as_deref(),
        session_id.as_deref(),
        model.as_deref(),
        project_path.as_deref(),
        None,
        &now,
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "updated": true }))
}

#[tauri::command]
pub async fn delete_chat_tab(db: State<'_, DbState>, id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_chat_tab(&conn, &id).map_err(|e| e.to_string())?;
    Ok(json!({ "deleted": true }))
}

#[tauri::command]
pub async fn reorder_chat_tabs(
    db: State<'_, DbState>,
    tab_ids: Vec<String>,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::reorder_chat_tabs(&conn, &tab_ids, &now).map_err(|e| e.to_string())?;
    Ok(json!({ "reordered": true }))
}
