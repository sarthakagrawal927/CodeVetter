use tauri::AppHandle;

#[tauri::command]
pub fn set_tray_text(app: AppHandle, text: String) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "tray not initialized".to_string())?;
    let value = if text.is_empty() { None } else { Some(text.as_str()) };
    tray.set_title(value).map_err(|e| e.to_string())?;
    if !text.is_empty() {
        let _ = tray.set_tooltip(Some(&text));
    }
    Ok(())
}
