use crate::db::queries::{self, AgentPresetRow};
use crate::DbState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn list_agent_presets(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let presets = queries::list_agent_presets(&conn).map_err(|e| e.to_string())?;
    Ok(json!({ "presets": presets }))
}

#[tauri::command]
pub async fn create_agent_preset(
    db: State<'_, DbState>,
    name: String,
    adapter: String,
    role: Option<String>,
    system_prompt: Option<String>,
    model: Option<String>,
    max_turns: Option<i64>,
    allowed_tools: Option<String>,
    output_format: Option<String>,
    print_mode: Option<bool>,
    no_session_persist: Option<bool>,
    approval_mode: Option<String>,
    quiet_mode: Option<bool>,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let preset = AgentPresetRow {
        id: id.clone(),
        name,
        adapter,
        role,
        system_prompt,
        model,
        max_turns,
        allowed_tools,
        output_format,
        print_mode: if print_mode.unwrap_or(false) { 1 } else { 0 },
        no_session_persist: if no_session_persist.unwrap_or(false) { 1 } else { 0 },
        approval_mode,
        quiet_mode: if quiet_mode.unwrap_or(false) { 1 } else { 0 },
        created_at: now.clone(),
        updated_at: now,
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_agent_preset(&conn, &preset).map_err(|e| e.to_string())?;

    Ok(json!({ "id": id, "preset": preset }))
}

#[tauri::command]
pub async fn update_agent_preset(
    db: State<'_, DbState>,
    id: String,
    name: String,
    adapter: String,
    role: Option<String>,
    system_prompt: Option<String>,
    model: Option<String>,
    max_turns: Option<i64>,
    allowed_tools: Option<String>,
    output_format: Option<String>,
    print_mode: Option<bool>,
    no_session_persist: Option<bool>,
    approval_mode: Option<String>,
    quiet_mode: Option<bool>,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let preset = AgentPresetRow {
        id: id.clone(),
        name,
        adapter,
        role,
        system_prompt,
        model,
        max_turns,
        allowed_tools,
        output_format,
        print_mode: if print_mode.unwrap_or(false) { 1 } else { 0 },
        no_session_persist: if no_session_persist.unwrap_or(false) { 1 } else { 0 },
        approval_mode,
        quiet_mode: if quiet_mode.unwrap_or(false) { 1 } else { 0 },
        created_at: String::new(), // not used in update
        updated_at: now,
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_agent_preset(&conn, &preset).map_err(|e| e.to_string())?;

    Ok(json!({ "id": id }))
}

#[tauri::command]
pub async fn delete_agent_preset(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_agent_preset(&conn, &id).map_err(|e| e.to_string())?;
    Ok(json!({ "deleted": true }))
}
