use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::adapters::claude_code::ClaudeCodeAdapter;

/// A streamed progress event pushed to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaywrightGenStreamEvent {
    pub request_id: String,
    pub event_type: String, // "progress" | "code" | "done" | "error"
    pub content: Value,
}

/// Individual test result from Playwright JSON reporter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaywrightTestResult {
    pub name: String,
    pub status: String, // "passed" | "failed" | "skipped" | "timedOut"
    pub duration_ms: f64,
    pub error: Option<String>,
}

/// Generate a Playwright test using Claude CLI.
///
/// Spawns `claude -p "<prompt>" --output-format stream-json --verbose`
/// and streams progress via `playwright-gen-stream` Tauri events.
/// Returns the generated test file path and code.
#[tauri::command]
pub async fn generate_playwright_test(
    app: tauri::AppHandle,
    url: String,
    description: String,
    project_path: Option<String>,
) -> Result<Value, String> {
    let cli_path = ClaudeCodeAdapter::detect_cli()
        .ok_or("Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code")?;

    // Determine output directory
    let output_dir = if let Some(ref path) = project_path {
        let p = std::path::PathBuf::from(path);
        if !p.is_dir() {
            return Err(format!("Project path does not exist: {path}"));
        }
        let tests_dir = p.join("tests");
        std::fs::create_dir_all(&tests_dir)
            .map_err(|e| format!("Failed to create tests directory: {e}"))?;
        tests_dir
    } else {
        let tmp = std::env::temp_dir().join("codevetter-playwright-tests");
        std::fs::create_dir_all(&tmp)
            .map_err(|e| format!("Failed to create temp directory: {e}"))?;
        tmp
    };

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let test_file = output_dir.join(format!("generated-{timestamp}.spec.ts"));
    let test_file_str = test_file.to_string_lossy().to_string();

    let request_id = uuid::Uuid::new_v4().to_string();
    let request_id_clone = request_id.clone();

    let prompt = format!(
        r#"Write a Playwright test for the website at {url}.

The test should: {description}

Requirements:
- Use TypeScript with Playwright's test runner (@playwright/test)
- Include proper imports: import {{ test, expect }} from '@playwright/test';
- Use descriptive test names
- Add reasonable timeouts and waits
- Use reliable selectors (prefer data-testid, role-based, or text-based selectors over fragile CSS)
- Include assertions to verify expected behavior

Return ONLY the complete test file code, nothing else. No markdown fences, no explanations — just the raw TypeScript code."#
    );

    // Build command
    let mut cmd = Command::new(&cli_path);
    cmd.arg("-p").arg(&prompt);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");

    if let Some(ref path) = project_path {
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

    // Read stderr on a separate thread
    let stderr_output = Arc::new(Mutex::new(String::new()));
    let stderr_clone = Arc::clone(&stderr_output);
    std::thread::Builder::new()
        .name("playwright-gen-stderr".into())
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

    // Stream stdout in background
    let app_clone = app.clone();
    let rid = request_id.clone();
    let test_file_for_thread = test_file_str.clone();

    std::thread::Builder::new()
        .name(format!("playwright-gen-{}", &rid[..8]))
        .spawn(move || {
            let reader = BufReader::new(stdout);
            let mut full_text = String::new();

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("playwright gen stream read error: {e}");
                        break;
                    }
                };

                if line.trim().is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        // Non-JSON output — treat as raw text
                        full_text.push_str(&line);
                        full_text.push('\n');
                        let _ = app_clone.emit(
                            "playwright-gen-stream",
                            PlaywrightGenStreamEvent {
                                request_id: rid.clone(),
                                event_type: "progress".into(),
                                content: json!({ "text": line }),
                            },
                        );
                        continue;
                    }
                };

                let event_type = parsed
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");

                // Extract text content from assistant messages
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

                // Forward progress events
                let mapped_type = match event_type {
                    "assistant" => "progress",
                    "content_block_start" => "progress",
                    "content_block_delta" => "progress",
                    "content_block_stop" => "progress",
                    "result" => "progress",
                    "system" => "progress",
                    other => other,
                };

                let _ = app_clone.emit(
                    "playwright-gen-stream",
                    PlaywrightGenStreamEvent {
                        request_id: rid.clone(),
                        event_type: mapped_type.into(),
                        content: parsed.clone(),
                    },
                );
            }

            // Wait for process to finish
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
                log::warn!("playwright gen stderr: {}", stderr_text);
            }

            // Clean the generated code — strip markdown fences if present
            let test_code = clean_generated_code(&full_text);

            // Save to file
            if let Err(e) = std::fs::write(&test_file_for_thread, &test_code) {
                log::error!("Failed to write test file: {e}");
                let _ = app_clone.emit(
                    "playwright-gen-stream",
                    PlaywrightGenStreamEvent {
                        request_id: rid.clone(),
                        event_type: "error".into(),
                        content: json!({ "error": format!("Failed to write test file: {e}") }),
                    },
                );
                return;
            }

            let _ = app_clone.emit(
                "playwright-gen-stream",
                PlaywrightGenStreamEvent {
                    request_id: rid.clone(),
                    event_type: "done".into(),
                    content: json!({
                        "test_file": test_file_for_thread,
                        "test_code": test_code,
                        "exit_code": exit_code,
                    }),
                },
            );
        })
        .map_err(|e| format!("Failed to spawn stream thread: {e}"))?;

    Ok(json!({
        "request_id": request_id_clone,
        "test_file": test_file_str,
        "status": "generating",
    }))
}

/// Run a Playwright test file and return structured results.
#[tauri::command]
pub async fn run_playwright_test(
    test_file: String,
    project_path: Option<String>,
) -> Result<Value, String> {
    let test_path = std::path::Path::new(&test_file);
    if !test_path.exists() {
        return Err(format!("Test file does not exist: {test_file}"));
    }

    let mut cmd = Command::new("npx");
    cmd.arg("playwright")
        .arg("test")
        .arg(&test_file)
        .arg("--reporter=json");

    if let Some(ref path) = project_path {
        cmd.current_dir(path);
    } else if let Some(parent) = test_path.parent() {
        cmd.current_dir(parent);
    }

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run playwright: {e}. Make sure Playwright is installed (npx playwright install)"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let passed = output.status.success();

    // Parse JSON reporter output
    let results = parse_playwright_json_output(&stdout);

    Ok(json!({
        "passed": passed,
        "results": results,
        "stdout": stdout,
        "stderr": stderr,
    }))
}

/// Iterate on a failed Playwright test by sending the error back to Claude.
#[tauri::command]
pub async fn iterate_playwright_test(
    app: tauri::AppHandle,
    test_file: String,
    error_message: String,
    url: String,
    description: String,
) -> Result<Value, String> {
    let cli_path = ClaudeCodeAdapter::detect_cli()
        .ok_or("Claude Code CLI not found.")?;

    let test_path = std::path::Path::new(&test_file);
    if !test_path.exists() {
        return Err(format!("Test file does not exist: {test_file}"));
    }

    let original_code = std::fs::read_to_string(&test_file)
        .map_err(|e| format!("Failed to read test file: {e}"))?;

    let prompt = format!(
        r#"This Playwright test failed. Fix it.

Site URL: {url}
Original intent: {description}

Current test code:
```typescript
{original_code}
```

Error message:
```
{error_message}
```

Return ONLY the complete fixed test file code. No markdown fences, no explanations — just the raw TypeScript code."#
    );

    let mut cmd = Command::new(&cli_path);
    cmd.arg("-p").arg(&prompt);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");

    if let Some(parent) = test_path.parent() {
        cmd.current_dir(parent);
    }

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn claude: {e}"))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let request_id = uuid::Uuid::new_v4().to_string();
    let request_id_clone = request_id.clone();

    // Read stderr in background
    let stderr_output = Arc::new(Mutex::new(String::new()));
    let stderr_clone = Arc::clone(&stderr_output);
    std::thread::Builder::new()
        .name("playwright-iterate-stderr".into())
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

    // Stream stdout
    let app_clone = app.clone();
    let rid = request_id.clone();
    let test_file_for_thread = test_file.clone();

    std::thread::Builder::new()
        .name(format!("playwright-iterate-{}", &rid[..8]))
        .spawn(move || {
            let reader = BufReader::new(stdout);
            let mut full_text = String::new();

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        log::error!("playwright iterate stream read error: {e}");
                        break;
                    }
                };

                if line.trim().is_empty() {
                    continue;
                }

                let parsed: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        full_text.push_str(&line);
                        full_text.push('\n');
                        let _ = app_clone.emit(
                            "playwright-gen-stream",
                            PlaywrightGenStreamEvent {
                                request_id: rid.clone(),
                                event_type: "progress".into(),
                                content: json!({ "text": line }),
                            },
                        );
                        continue;
                    }
                };

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

                let _ = app_clone.emit(
                    "playwright-gen-stream",
                    PlaywrightGenStreamEvent {
                        request_id: rid.clone(),
                        event_type: "progress".into(),
                        content: parsed.clone(),
                    },
                );
            }

            let exit_status = child.wait();
            let exit_code = exit_status
                .as_ref()
                .map(|s| s.code().unwrap_or(-1))
                .unwrap_or(-1);

            // Clean and save the fixed code
            let test_code = clean_generated_code(&full_text);

            if let Err(e) = std::fs::write(&test_file_for_thread, &test_code) {
                log::error!("Failed to write iterated test file: {e}");
                let _ = app_clone.emit(
                    "playwright-gen-stream",
                    PlaywrightGenStreamEvent {
                        request_id: rid.clone(),
                        event_type: "error".into(),
                        content: json!({ "error": format!("Failed to write test file: {e}") }),
                    },
                );
                return;
            }

            let _ = app_clone.emit(
                "playwright-gen-stream",
                PlaywrightGenStreamEvent {
                    request_id: rid.clone(),
                    event_type: "done".into(),
                    content: json!({
                        "test_file": test_file_for_thread,
                        "test_code": test_code,
                        "exit_code": exit_code,
                    }),
                },
            );
        })
        .map_err(|e| format!("Failed to spawn iterate thread: {e}"))?;

    Ok(json!({
        "request_id": request_id_clone,
        "test_file": test_file,
        "status": "iterating",
    }))
}

/// Strip markdown code fences from generated output.
fn clean_generated_code(raw: &str) -> String {
    let trimmed = raw.trim();

    // Remove ```typescript or ```ts fences
    let without_opening = if trimmed.starts_with("```") {
        // Find end of first line
        if let Some(idx) = trimmed.find('\n') {
            &trimmed[idx + 1..]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    // Remove trailing ```
    let cleaned = if without_opening.trim_end().ends_with("```") {
        let end = without_opening.rfind("```").unwrap_or(without_opening.len());
        &without_opening[..end]
    } else {
        without_opening
    };

    cleaned.trim().to_string()
}

/// Parse Playwright JSON reporter output into structured results.
fn parse_playwright_json_output(stdout: &str) -> Vec<PlaywrightTestResult> {
    let parsed: Value = match serde_json::from_str(stdout) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let mut results = Vec::new();

    // Playwright JSON reporter structure: { suites: [{ specs: [{ tests: [...] }] }] }
    if let Some(suites) = parsed.get("suites").and_then(|v| v.as_array()) {
        for suite in suites {
            if let Some(specs) = suite.get("specs").and_then(|v| v.as_array()) {
                for spec in specs {
                    let name = spec
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let ok = spec
                        .get("ok")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // Get duration and error from the tests array
                    let mut duration_ms = 0.0;
                    let mut error = None;
                    let mut status = if ok { "passed" } else { "failed" };

                    if let Some(tests) = spec.get("tests").and_then(|v| v.as_array()) {
                        for test in tests {
                            if let Some(results_arr) =
                                test.get("results").and_then(|v| v.as_array())
                            {
                                for result in results_arr {
                                    duration_ms = result
                                        .get("duration")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or(0.0);

                                    if let Some(s) =
                                        result.get("status").and_then(|v| v.as_str())
                                    {
                                        status = s;
                                    }

                                    if let Some(err) = result.get("error") {
                                        error = err
                                            .get("message")
                                            .and_then(|v| v.as_str())
                                            .map(String::from);
                                    }
                                }
                            }
                        }
                    }

                    results.push(PlaywrightTestResult {
                        name,
                        status: status.to_string(),
                        duration_ms,
                        error,
                    });
                }
            }
        }
    }

    results
}
