use crate::db::queries::{self, LocalReviewInput, ActivityInput};
use crate::DbState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command as StdCommand;
use tauri::State;

/// Finding shape received from the frontend (review-core running in webview).
#[derive(Debug, Deserialize)]
pub struct ReviewFindingInput {
    pub severity: String,
    pub title: String,
    pub summary: String,
    pub suggestion: Option<String>,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub line: Option<i64>,
    pub confidence: Option<f64>,
    pub fingerprint: Option<String>,
}

/// Get the git diff for a local repository.
/// Returns the diff text and changed file list for the frontend to feed into review-core.
#[tauri::command]
pub async fn get_local_diff(
    repo_path: String,
    diff_range: Option<String>,
) -> Result<Value, String> {
    // Run git diff
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

    // Get changed file list
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

    Ok(json!({
        "diff": diff_text,
        "files": files,
        "empty": diff_text.trim().is_empty(),
    }))
}

/// Save review results from the frontend (review-core running in webview).
/// The frontend calls review-core + ai-gateway-client, then sends findings here for persistence.
#[tauri::command]
pub async fn save_review(
    db: State<'_, DbState>,
    repo_path: Option<String>,
    source_label: String,
    review_type: String,
    repo_full_name: Option<String>,
    pr_number: Option<i64>,
    score: f64,
    findings: Vec<ReviewFindingInput>,
    review_action: Option<String>,
    summary_markdown: Option<String>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Create review record
    let input = LocalReviewInput {
        review_type: Some(review_type),
        source_label: Some(source_label.clone()),
        repo_path: repo_path.clone(),
        repo_full_name,
        pr_number,
        agent_used: Some("review-core".to_string()),
        status: Some("completed".to_string()),
    };

    let review_id = queries::create_local_review(&conn, &input)
        .map_err(|e| e.to_string())?;

    // Insert findings
    for f in &findings {
        queries::insert_review_finding(
            &conn,
            &crate::db::queries::LocalReviewFindingInput {
                review_id: review_id.clone(),
                severity: f.severity.clone(),
                title: f.title.clone(),
                summary: f.summary.clone(),
                suggestion: f.suggestion.clone(),
                file_path: f.file_path.clone(),
                line: f.line,
                confidence: f.confidence,
                fingerprint: f.fingerprint.clone(),
            },
        )
        .map_err(|e| e.to_string())?;
    }

    // Update review with score and completion
    queries::update_local_review(
        &conn,
        &review_id,
        &crate::db::queries::LocalReviewUpdate {
            status: Some("completed".to_string()),
            score_composite: Some(score),
            findings_count: Some(findings.len() as i64),
            review_action,
            summary_markdown,
            error_message: None,
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    )
    .map_err(|e| e.to_string())?;

    // Log activity
    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: None,
            event_type: Some("review_completed".to_string()),
            summary: Some(format!(
                "Review completed for {}: score={:.0}, {} findings",
                source_label, score, findings.len()
            )),
            metadata: Some(json!({"review_id": review_id}).to_string()),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "review_id": review_id,
        "status": "completed",
        "score": score,
        "findings_count": findings.len(),
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
