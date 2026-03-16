use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

use crate::adapters::claude_code::ClaudeCodeAdapter;
use crate::DbState;

/// A single streamed event pushed to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStreamEvent {
    pub chat_id: String,
    pub event_type: String, // "text_delta" | "tool_use" | "tool_result" | "result" | "error"
    pub content: Value,
}

/// Start a new chat session or continue an existing one.
///
/// Spawns `claude -p "<message>" --output-format stream-json [--resume <id>]`
/// and streams the response back via `chat-stream` Tauri events.
///
/// Returns immediately with a `chat_id` — the frontend listens for events.
#[tauri::command]
pub async fn send_chat_message(
    app: tauri::AppHandle,
    _db: State<'_, DbState>,
    message: String,
    session_id: Option<String>,
    project_path: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    let cli_path = ClaudeCodeAdapter::detect_cli()
        .ok_or("Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code")?;

    // Validate session_id is a valid UUID if provided
    if let Some(sid) = &session_id {
        uuid::Uuid::parse_str(sid)
            .map_err(|_| format!("Invalid session ID: {sid}"))?;
    }

    // Validate project_path exists if provided
    if let Some(path) = &project_path {
        if !std::path::Path::new(path).is_dir() {
            return Err(format!("Project path does not exist: {path}"));
        }
    }

    let chat_id = uuid::Uuid::new_v4().to_string();
    let chat_id_clone = chat_id.clone();

    // Build command
    let mut cmd = Command::new(&cli_path);
    cmd.arg("-p").arg(&message);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");

    if let Some(m) = &model {
        cmd.arg("--model").arg(m);
    }

    // Resume existing session: pass session ID as --resume's value
    if let Some(sid) = &session_id {
        cmd.arg("--resume").arg(sid);
    }

    if let Some(path) = &project_path {
        cmd.current_dir(path);
    }

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Read stderr on a separate thread to prevent deadlock
    let stderr_output = Arc::new(Mutex::new(String::new()));
    let stderr_clone = Arc::clone(&stderr_output);
    std::thread::Builder::new()
        .name("chat-stderr".into())
        .spawn(move || {
            let reader = BufReader::new(stderr);
            let mut buf = String::new();
            for line in reader.lines() {
                if let Ok(l) = line {
                    if !buf.is_empty() {
                        buf.push('\n');
                    }
                    buf.push_str(&l);
                }
            }
            if let Ok(mut out) = stderr_clone.lock() {
                *out = buf;
            }
        })
        .ok();

    // Stream stdout in a background thread
    let app_clone = app.clone();
    let cid = chat_id.clone();
    std::thread::Builder::new()
        .name(format!("chat-stream-{}", &cid[..8]))
        .spawn(move || {
            let reader = BufReader::new(stdout);
            let mut captured_session_id: Option<String> = None;
            let mut full_text = String::new();

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("chat stream read error: {e}");
                        break;
                    }
                };

                if line.trim().is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        let _ = app_clone.emit(
                            "chat-stream",
                            ChatStreamEvent {
                                chat_id: cid.clone(),
                                event_type: "text_delta".into(),
                                content: json!({ "text": line }),
                            },
                        );
                        full_text.push_str(&line);
                        full_text.push('\n');
                        continue;
                    }
                };

                if let Some(sid) = parsed.get("session_id").and_then(|v| v.as_str()) {
                    captured_session_id = Some(sid.to_string());
                }
                if let Some(sid) = parsed
                    .get("result")
                    .and_then(|r| r.get("session_id"))
                    .and_then(|v| v.as_str())
                {
                    captured_session_id = Some(sid.to_string());
                }

                let event_type = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");

                if event_type == "assistant" {
                    if let Some(content) = parsed.get("message").and_then(|m| m.get("content")) {
                        if let Some(arr) = content.as_array() {
                            for block in arr {
                                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                        full_text.push_str(t);
                                    }
                                }
                            }
                        }
                    }
                }

                let mapped_type = match event_type {
                    "assistant" => "assistant",
                    "content_block_start" => "content_block_start",
                    "content_block_delta" => "text_delta",
                    "content_block_stop" => "content_block_stop",
                    "result" => "result",
                    "system" => "system",
                    other => other,
                };

                let _ = app_clone.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        chat_id: cid.clone(),
                        event_type: mapped_type.into(),
                        content: parsed.clone(),
                    },
                );
            }

            let exit_status = child.wait();
            let exit_code = exit_status
                .as_ref()
                .map(|s| s.code().unwrap_or(-1))
                .unwrap_or(-1);

            let stderr_text = stderr_output
                .lock()
                .map(|s| s.clone())
                .unwrap_or_default();

            if !stderr_text.is_empty() && exit_code != 0 {
                log::warn!("chat stderr: {}", stderr_text);
            }

            let _ = app_clone.emit(
                "chat-stream",
                ChatStreamEvent {
                    chat_id: cid.clone(),
                    event_type: "done".into(),
                    content: json!({
                        "session_id": captured_session_id,
                        "exit_code": exit_code,
                        "stderr": if stderr_text.is_empty() { None } else { Some(&stderr_text) },
                    }),
                },
            );
        })
        .map_err(|e| format!("Failed to spawn stream thread: {e}"))?;

    Ok(json!({
        "chat_id": chat_id_clone,
        "status": "streaming",
    }))
}

/// List available models (for model picker).
#[tauri::command]
pub async fn list_chat_models() -> Result<Value, String> {
    Ok(json!({
        "models": [
            { "id": "sonnet", "label": "Claude Sonnet", "default": true },
            { "id": "opus", "label": "Claude Opus" },
            { "id": "haiku", "label": "Claude Haiku" },
        ]
    }))
}
