use crate::db::queries::{
    self, ActivityInput, LocalReviewFindingInput, LocalReviewInput, LocalReviewUpdate,
};
use crate::DbState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command as StdCommand;
use tauri::State;

/// Sidecar output shape (matches the TypeScript SidecarOutput type).
#[derive(Debug, Deserialize)]
struct SidecarOutput {
    success: bool,
    score: Option<f64>,
    findings: Option<Vec<SidecarFinding>>,
    #[serde(rename = "reviewAction")]
    review_action: Option<String>,
    #[serde(rename = "summaryMarkdown")]
    summary_markdown: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SidecarFinding {
    severity: String,
    title: String,
    summary: String,
    suggestion: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
    line: Option<i64>,
    confidence: Option<f64>,
    fingerprint: String,
}

/// Resolve the path to the review sidecar binary.
/// Looks for it next to the Tauri binary, or falls back to `bun run`.
fn resolve_sidecar() -> (String, Vec<String>) {
    // In production, the sidecar is compiled and bundled next to the app binary.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    if let Some(dir) = &exe_dir {
        let sidecar_path = dir.join("review-sidecar");
        if sidecar_path.exists() {
            return (sidecar_path.to_string_lossy().to_string(), vec![]);
        }
    }

    // Dev fallback: use bun to run the TypeScript source directly.
    let sidecar_src = exe_dir
        .as_ref()
        .map(|d| {
            d.join("../src-tauri/sidecar/src/main.ts")
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_else(|| "src-tauri/sidecar/src/main.ts".to_string());

    ("bun".to_string(), vec!["run".to_string(), sidecar_src])
}

/// Invoke the TypeScript sidecar with a JSON payload on stdin
/// and parse the JSON result from stdout.
fn call_sidecar(input_json: &Value) -> Result<SidecarOutput, String> {
    let (program, base_args) = resolve_sidecar();

    let mut cmd = StdCommand::new(&program);
    cmd.args(&base_args);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar ({program}): {e}"))?;

    // Write input JSON to stdin
    if let Some(stdin) = child.stdin.take() {
        let mut stdin = stdin;
        serde_json::to_writer(&mut stdin, input_json)
            .map_err(|e| format!("Failed to write to sidecar stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to read sidecar output: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!(
            "Sidecar exited with code {}: {}",
            output.status.code().unwrap_or(-1),
            stderr.chars().take(500).collect::<String>()
        ));
    }

    serde_json::from_str::<SidecarOutput>(&stdout).map_err(|e| {
        format!(
            "Failed to parse sidecar output: {e}\nOutput: {}",
            stdout.chars().take(300).collect::<String>()
        )
    })
}

/// Persist sidecar findings into the database and update the review record.
fn persist_review_result(
    conn: &rusqlite::Connection,
    review_id: &str,
    result: &SidecarOutput,
) -> Result<(), String> {
    if !result.success {
        queries::update_local_review(
            conn,
            review_id,
            &LocalReviewUpdate {
                status: Some("failed".to_string()),
                error_message: result.error.clone(),
                completed_at: Some(chrono::Utc::now().to_rfc3339()),
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Insert each finding
    let findings = result.findings.as_deref().unwrap_or(&[]);
    for f in findings {
        queries::insert_review_finding(
            conn,
            &LocalReviewFindingInput {
                review_id: review_id.to_string(),
                severity: f.severity.clone(),
                title: f.title.clone(),
                summary: f.summary.clone(),
                suggestion: f.suggestion.clone(),
                file_path: f.file_path.clone(),
                line: f.line,
                confidence: f.confidence,
                fingerprint: Some(f.fingerprint.clone()),
            },
        )
        .map_err(|e| e.to_string())?;
    }

    // Update the review record
    queries::update_local_review(
        conn,
        review_id,
        &LocalReviewUpdate {
            status: Some("completed".to_string()),
            score_composite: result.score,
            findings_count: Some(findings.len() as i64),
            review_action: result.review_action.clone(),
            summary_markdown: result.summary_markdown.clone(),
            error_message: None,
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Start a local code review by running `git diff` in the given repo.
#[tauri::command]
pub async fn start_local_review(
    db: State<'_, DbState>,
    repo_path: String,
    diff_range: Option<String>,
    tone: Option<String>,
) -> Result<Value, String> {
    // 1. Run git diff
    let mut cmd = StdCommand::new("git");
    cmd.arg("diff");
    if let Some(ref range) = diff_range {
        cmd.arg(range);
    }
    cmd.current_dir(&repo_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git diff: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {stderr}"));
    }

    let diff_text = String::from_utf8_lossy(&output.stdout).to_string();
    if diff_text.trim().is_empty() {
        return Err("git diff returned no changes".to_string());
    }

    // 2. Get changed file list
    let name_status_output = StdCommand::new("git")
        .args(["diff", "--name-status"])
        .args(diff_range.as_deref().map(|r| vec![r]).unwrap_or_default())
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("git diff --name-status failed: {e}"))?;

    let files: Vec<Value> = String::from_utf8_lossy(&name_status_output.stdout)
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, '\t').collect();
            if parts.len() == 2 {
                let status = match parts[0] {
                    "A" => "added",
                    "M" => "modified",
                    "D" => "removed",
                    "R" => "renamed",
                    _ => "modified",
                };
                Some(json!({"path": parts[1], "status": status}))
            } else {
                None
            }
        })
        .collect();

    // 3. Create review record
    let source_label = diff_range
        .clone()
        .unwrap_or_else(|| "working tree".to_string());

    let input = LocalReviewInput {
        review_type: Some("local_diff".to_string()),
        source_label: Some(source_label),
        repo_path: Some(repo_path.clone()),
        repo_full_name: None,
        pr_number: None,
        agent_used: Some("claude-code".to_string()),
        status: Some("analyzing".to_string()),
    };

    let review_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let rid = queries::create_local_review(&conn, &input).map_err(|e| e.to_string())?;

        queries::log_activity(
            &conn,
            &ActivityInput {
                agent_id: None,
                event_type: Some("review_started".to_string()),
                summary: Some(format!("Local review started for {repo_path}")),
                metadata: Some(
                    json!({
                        "review_id": rid,
                        "tone": tone,
                        "diff_bytes": diff_text.len(),
                        "file_count": files.len(),
                    })
                    .to_string(),
                ),
            },
        )
        .map_err(|e| e.to_string())?;

        rid
    };

    // 4. Call the sidecar asynchronously (spawn blocking since it may take a while)
    let review_id_clone = review_id.clone();
    let db_inner = db.inner().clone();
    let tone_clone = tone.clone();

    // Spawn the sidecar call in a background thread
    tokio::task::spawn_blocking(move || {
        let sidecar_input = json!({
            "action": "review_diff",
            "payload": {
                "diff": diff_text,
                "files": files,
                "repoPath": repo_path,
                "tone": tone_clone.unwrap_or_else(|| "balanced".to_string()),
            }
        });

        let result = call_sidecar(&sidecar_input);

        match result {
            Ok(output) => {
                let conn = db_inner.0.lock().unwrap();
                if let Err(e) = persist_review_result(&conn, &review_id_clone, &output) {
                    log::error!("Failed to persist review result: {e}");
                }

                let event_summary = if output.success {
                    format!(
                        "Review completed: score={}, findings={}",
                        output.score.unwrap_or(0.0),
                        output.findings.as_ref().map(|f| f.len()).unwrap_or(0)
                    )
                } else {
                    format!(
                        "Review failed: {}",
                        output.error.unwrap_or_else(|| "unknown".to_string())
                    )
                };

                queries::log_activity(
                    &conn,
                    &ActivityInput {
                        agent_id: None,
                        event_type: Some("review_completed".to_string()),
                        summary: Some(event_summary),
                        metadata: Some(json!({"review_id": review_id_clone}).to_string()),
                    },
                )
                .ok();
            }
            Err(e) => {
                log::error!("Sidecar call failed: {e}");
                if let Ok(conn) = db_inner.0.lock() {
                    queries::update_local_review(
                        &conn,
                        &review_id_clone,
                        &LocalReviewUpdate {
                            status: Some("failed".to_string()),
                            error_message: Some(e.clone()),
                            completed_at: Some(chrono::Utc::now().to_rfc3339()),
                            ..Default::default()
                        },
                    )
                    .ok();
                }
            }
        }
    });

    // Return immediately with the review ID — frontend polls for completion
    Ok(json!({
        "review_id": review_id,
        "status": "analyzing",
    }))
}

/// Start a review for a GitHub pull request.
/// Uses the sidecar's `review_pr` action which calls the GitHub API directly
/// via the review-core library (getPrDiffWithPat / getPrFilesWithPat).
#[tauri::command]
pub async fn start_pr_review(
    db: State<'_, DbState>,
    owner: String,
    repo: String,
    pr_number: i64,
    tone: Option<String>,
) -> Result<Value, String> {
    // Read GitHub PAT from preferences
    let github_pat = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_preference(&conn, "github_token")
            .map_err(|e| e.to_string())?
    };

    // Fall back to GH_TOKEN / GITHUB_TOKEN env vars if no saved preference
    let github_pat = github_pat
        .or_else(|| std::env::var("GH_TOKEN").ok())
        .or_else(|| std::env::var("GITHUB_TOKEN").ok());

    let github_pat = match github_pat {
        Some(pat) if !pat.is_empty() => pat,
        _ => {
            // Last resort: try to get token from gh CLI auth
            let gh_output = StdCommand::new("gh")
                .args(["auth", "token"])
                .output()
                .ok();
            match gh_output {
                Some(o) if o.status.success() => {
                    String::from_utf8_lossy(&o.stdout).trim().to_string()
                }
                _ => return Err(
                    "No GitHub token found. Set one in Settings, or set GH_TOKEN / GITHUB_TOKEN environment variable, or authenticate with `gh auth login`.".to_string()
                ),
            }
        }
    };

    // Create review record
    let input = LocalReviewInput {
        review_type: Some("local_pr".to_string()),
        source_label: Some(format!("{owner}/{repo}#{pr_number}")),
        repo_path: None,
        repo_full_name: Some(format!("{owner}/{repo}")),
        pr_number: Some(pr_number),
        agent_used: Some("claude-code".to_string()),
        status: Some("analyzing".to_string()),
    };

    let review_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let rid = queries::create_local_review(&conn, &input).map_err(|e| e.to_string())?;

        queries::log_activity(
            &conn,
            &ActivityInput {
                agent_id: None,
                event_type: Some("pr_review_started".to_string()),
                summary: Some(format!("PR review started for {owner}/{repo}#{pr_number}")),
                metadata: Some(json!({"review_id": rid}).to_string()),
            },
        )
        .map_err(|e| e.to_string())?;

        rid
    };

    // Spawn sidecar in background — use the `review_pr` action which
    // fetches the diff/files via the GitHub API using the PAT.
    let review_id_clone = review_id.clone();
    let db_inner = db.inner().clone();
    let tone_clone = tone.clone();

    tokio::task::spawn_blocking(move || {
        let sidecar_input = json!({
            "action": "review_pr",
            "payload": {
                "owner": owner,
                "repo": repo,
                "prNumber": pr_number,
                "githubPat": github_pat,
                "tone": tone_clone.unwrap_or_else(|| "balanced".to_string()),
            }
        });

        match call_sidecar(&sidecar_input) {
            Ok(output) => {
                let conn = db_inner.0.lock().unwrap();
                if let Err(e) = persist_review_result(&conn, &review_id_clone, &output) {
                    log::error!("Failed to persist PR review result: {e}");
                }

                let event_summary = if output.success {
                    format!(
                        "PR review completed: score={}, findings={}",
                        output.score.unwrap_or(0.0),
                        output.findings.as_ref().map(|f| f.len()).unwrap_or(0)
                    )
                } else {
                    format!(
                        "PR review failed: {}",
                        output.error.unwrap_or_else(|| "unknown".to_string())
                    )
                };

                queries::log_activity(
                    &conn,
                    &ActivityInput {
                        agent_id: None,
                        event_type: Some("review_completed".to_string()),
                        summary: Some(event_summary),
                        metadata: Some(json!({"review_id": review_id_clone}).to_string()),
                    },
                )
                .ok();
            }
            Err(e) => {
                log::error!("Sidecar call failed for PR review: {e}");
                if let Ok(conn) = db_inner.0.lock() {
                    queries::update_local_review(
                        &conn,
                        &review_id_clone,
                        &LocalReviewUpdate {
                            status: Some("failed".to_string()),
                            error_message: Some(e),
                            completed_at: Some(chrono::Utc::now().to_rfc3339()),
                            ..Default::default()
                        },
                    )
                    .ok();
                }
            }
        }
    });

    Ok(json!({
        "review_id": review_id,
        "status": "analyzing",
    }))
}

/// Get a single review with all its findings.
#[tauri::command]
pub async fn get_review(db: State<'_, DbState>, id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (review, findings) =
        queries::get_local_review_with_findings(&conn, &id).map_err(|e| e.to_string())?;
    Ok(json!({
        "review": review,
        "findings": findings,
    }))
}

/// List reviews with pagination.
#[tauri::command]
pub async fn list_reviews(
    db: State<'_, DbState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let reviews = queries::list_local_reviews(&conn, limit.unwrap_or(50), offset.unwrap_or(0))
        .map_err(|e| e.to_string())?;
    Ok(json!({ "reviews": reviews }))
}
