use crate::db::queries::{self, ActivityInput};
use crate::DbState;
use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Track the latest commit SHA per project directory.
///
/// Periodically polls `git log --oneline -1` in each active agent's
/// project_path.  When a new commit appears, logs it in the activity feed
/// and emits a Tauri event + system notification.
pub fn start_git_watcher(db: DbState, app_handle: AppHandle) {
    std::thread::Builder::new()
        .name("git-watcher".into())
        .spawn(move || {
            let mut known_heads: HashMap<String, String> = HashMap::new();
            loop {
                std::thread::sleep(Duration::from_secs(15));

                // Get all active agent project paths.
                let project_paths = match db.0.lock() {
                    Ok(conn) => queries::list_agent_processes(&conn)
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|a| a.status == "running")
                        .filter_map(|a| {
                            a.project_path
                                .map(|p| (a.id.clone(), p))
                        })
                        .collect::<Vec<_>>(),
                    Err(_) => continue,
                };

                for (agent_id, project_path) in &project_paths {
                    let head = match get_git_head(project_path) {
                        Some(h) => h,
                        None => continue,
                    };

                    let key = project_path.clone();
                    let is_new = match known_heads.get(&key) {
                        Some(prev) => prev != &head,
                        None => {
                            // First time seeing this project; record but don't
                            // log an activity (the commit may be old).
                            known_heads.insert(key, head);
                            continue;
                        }
                    };

                    if is_new {
                        known_heads.insert(key, head.clone());

                        // Fetch the commit message for the activity log.
                        let commit_msg = get_commit_message(project_path, &head)
                            .unwrap_or_else(|| head.clone());

                        let project_name = project_path
                            .rsplit('/')
                            .next()
                            .unwrap_or(project_path);

                        if let Ok(conn) = db.0.lock() {
                            let _ = queries::log_activity(
                                &conn,
                                &ActivityInput {
                                    agent_id: Some(agent_id.clone()),
                                    event_type: Some("commit".to_string()),
                                    summary: Some(format!(
                                        "New commit in {}: {}",
                                        project_name, commit_msg
                                    )),
                                    metadata: Some(
                                        serde_json::json!({
                                            "sha": head,
                                            "project_path": project_path,
                                        })
                                        .to_string(),
                                    ),
                                },
                            );
                        }

                        // Emit Tauri event so frontend activity feed updates
                        let _ = app_handle.emit("activity-update", serde_json::json!({
                            "event_type": "commit",
                            "agent_id": agent_id,
                            "summary": format!("New commit in {}: {}", project_name, commit_msg),
                            "sha": head,
                        }));

                        // System notification
                        send_notification(
                            &app_handle,
                            &format!("New commit in {}", project_name),
                            &commit_msg,
                        );
                    }
                }
            }
        })
        .expect("failed to spawn git-watcher thread");
}

/// Get the HEAD commit SHA for a given directory.
fn get_git_head(dir: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Get the one-line commit message for a specific SHA.
fn get_commit_message(dir: &str, sha: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["log", "--oneline", "-1", sha])
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Send a system notification via the Tauri notification plugin.
fn send_notification(app_handle: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}
