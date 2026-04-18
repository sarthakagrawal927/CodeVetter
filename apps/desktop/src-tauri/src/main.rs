// Prevent a console window from popping up on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod talk;

use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Shared database state accessible from every Tauri command via
/// `tauri::State<DbState>`.
#[derive(Clone)]
pub struct DbState(pub Arc<Mutex<rusqlite::Connection>>);

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let conn = db::init_db(app_data_dir.clone()).expect("failed to initialize database");
            app.manage(DbState(Arc::new(Mutex::new(conn))));

            // ── Trigger initial index on startup ─────────────────
            let bg_data_dir = app_data_dir;
            std::thread::Builder::new()
                .name("initial-index".into())
                .spawn(move || {
                    log::info!("Starting quick index on startup...");
                    match run_initial_index(bg_data_dir.clone()) {
                        Ok(msg) => log::info!("Quick index complete: {msg}"),
                        Err(e) => log::error!("Quick index failed: {e}"),
                    }

                    log::info!("Starting full index...");
                    match run_full_index(bg_data_dir) {
                        Ok(msg) => log::info!("Full index complete: {msg}"),
                        Err(e) => log::error!("Full index failed: {e}"),
                    }
                })
                .expect("failed to spawn initial-index thread");

            // ── Periodic re-index (every 15 minutes) ─────────────
            let periodic_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            std::thread::Builder::new()
                .name("periodic-index".into())
                .spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(180));
                    loop {
                        log::info!("Periodic re-index starting...");
                        match db::init_db(periodic_data_dir.clone()) {
                            Ok(conn) => {
                                match crate::commands::history::run_full_index_with_conn(&conn) {
                                    Ok(msg) => log::info!("Periodic re-index complete: {msg}"),
                                    Err(e) => log::error!("Periodic re-index failed: {e}"),
                                }
                            }
                            Err(e) => {
                                log::error!("Periodic re-index DB init failed: {e}");
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_secs(900));
                    }
                })
                .expect("failed to spawn periodic-index thread");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Review
            commands::review::get_local_diff,
            commands::review::save_review,
            commands::review::get_review,
            commands::review::list_reviews,
            commands::review::run_cli_review,
            commands::review::fix_findings,
            commands::review::merge_fix,
            commands::review::discard_fix,
            commands::review::revert_files,
            // Blast radius (graph-aware PR analysis)
            commands::blast_radius::analyze_blast_radius,
            // Sessions (used by Home for index stats)
            commands::sessions::list_sessions,
            commands::sessions::merge_projects,
            // History / indexer
            commands::history::trigger_index,
            commands::history::get_index_stats,
            commands::history::detect_cursor,
            // Git
            commands::git::list_git_branches,
            commands::git::get_git_remote_info,
            commands::git::list_pull_requests,
            commands::git::check_github_auth,
            commands::git::sync_github_token,
            commands::git::get_git_changed_files,
            // GitHub PR & CI
            commands::github_ops::create_pull_request,
            commands::github_ops::list_pull_requests_for_repo,
            commands::github_ops::get_pull_request,
            commands::github_ops::merge_pull_request,
            commands::github_ops::list_ci_checks,
            commands::github_ops::rerun_failed_checks,
            // Provider Accounts (Usage tab)
            commands::accounts::list_provider_accounts,
            commands::accounts::create_provider_account,
            commands::accounts::update_provider_account,
            commands::accounts::delete_provider_account,
            commands::accounts::check_account_usage,
            commands::accounts::check_live_usage,
            commands::accounts::detect_provider_accounts,
            // Preferences
            commands::preferences::get_preference,
            commands::preferences::set_preference,
            // File operations (used by Review)
            commands::files::list_directory_tree,
            commands::files::read_file_preview,
            commands::files::read_file_around_line,
            commands::files::open_in_app,
            // Setup
            commands::setup::check_prerequisites,
            // Agent Talks
            commands::talks::get_talk,
            commands::talks::list_project_talks,
            commands::talks::get_latest_talk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Run a lightweight startup index using its own database connection.
fn run_initial_index(app_data_dir: std::path::PathBuf) -> Result<String, String> {
    use crate::db::queries;

    let conn = db::init_db(app_data_dir).map_err(|e| e.to_string())?;

    let all_bases = resolve_all_claude_projects_dirs();

    let project_dirs: Vec<_> = all_bases
        .iter()
        .filter(|b| b.exists())
        .flat_map(|b| std::fs::read_dir(b).ok().into_iter())
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .collect();

    if project_dirs.is_empty() {
        return Ok("No Claude project directories found".to_string());
    }

    let mut indexed_sessions = 0u64;
    let mut skipped = 0u64;

    for project_entry in &project_dirs {
        let project_path = project_entry.path();
        let project_dir_name = project_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let display_name = resolve_project_display_name(&project_dir_name);
        let dir_path_str = project_path.to_string_lossy().to_string();

        let project_id = queries::get_project_id_by_dir(&conn, &dir_path_str)
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let now = chrono::Utc::now().to_rfc3339();

        queries::upsert_project(
            &conn,
            &queries::ProjectInput {
                id: project_id.clone(),
                display_name,
                dir_path: dir_path_str,
                session_count: None,
                last_activity: Some(now.clone()),
                created_at: now.clone(),
            },
        )
        .map_err(|e| e.to_string())?;

        let jsonl_files = walkdir(&project_path, "jsonl");

        for jsonl_path in &jsonl_files {
            let jsonl_path_str = jsonl_path.to_string_lossy().to_string();
            let file_meta = std::fs::metadata(jsonl_path).ok();
            let file_mtime_str = file_meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

            if let Ok(Some(existing)) =
                queries::get_session_by_jsonl_path(&conn, &jsonl_path_str)
            {
                if existing.file_mtime.as_deref() == file_mtime_str.as_deref() {
                    skipped += 1;
                    continue;
                }
            }

            let (session_id, meta) = quick_parse_session_meta(jsonl_path);

            queries::upsert_session(
                &conn,
                &queries::SessionInput {
                    id: session_id,
                    project_id: project_id.clone(),
                    agent_type: Some("claude-code".to_string()),
                    jsonl_path: Some(jsonl_path_str),
                    git_branch: meta.git_branch,
                    cwd: meta.cwd,
                    cli_version: meta.version,
                    first_message: meta.first_timestamp,
                    last_message: None,
                    message_count: None,
                    total_input_tokens: None,
                    total_output_tokens: None,
                    model_used: meta.model,
                    slug: meta.slug,
                    file_size_bytes: None,
                    indexed_at: None,
                    file_mtime: None,
                    cache_read_tokens: None,
                    cache_creation_tokens: None,
                    compaction_count: None,
                    estimated_cost_usd: None,
                },
            )
            .map_err(|e| e.to_string())?;

            indexed_sessions += 1;
        }

        let session_count = jsonl_files.len() as i64;
        conn.execute(
            "UPDATE cc_projects SET session_count = ?2 WHERE id = ?1",
            rusqlite::params![project_id, session_count],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(format!(
        "projects={}, indexed={}, skipped={}",
        project_dirs.len(),
        indexed_sessions,
        skipped
    ))
}

fn run_full_index(app_data_dir: std::path::PathBuf) -> Result<String, String> {
    use crate::commands::history;
    let conn = db::init_db(app_data_dir).map_err(|e| e.to_string())?;
    history::run_full_index_with_conn(&conn)
}

struct QuickMeta {
    version: Option<String>,
    git_branch: Option<String>,
    cwd: Option<String>,
    slug: Option<String>,
    model: Option<String>,
    first_timestamp: Option<String>,
}

fn quick_parse_session_meta(path: &std::path::Path) -> (String, QuickMeta) {
    use std::io::BufRead;

    let mut meta = QuickMeta {
        version: None,
        git_branch: None,
        cwd: None,
        slug: None,
        model: None,
        first_timestamp: None,
    };

    let mut session_id = uuid::Uuid::new_v4().to_string();

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (session_id, meta),
    };

    let reader = std::io::BufReader::new(file);

    for line in reader.lines().take(10) {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if let Some(sid) = parsed.get("sessionId").and_then(|v| v.as_str()) {
            session_id = sid.to_string();
        }
        if meta.version.is_none() {
            meta.version = parsed.get("version").and_then(|v| v.as_str()).map(String::from);
        }
        if meta.git_branch.is_none() {
            meta.git_branch = parsed.get("gitBranch").and_then(|v| v.as_str()).map(String::from);
        }
        if meta.cwd.is_none() {
            meta.cwd = parsed.get("cwd").and_then(|v| v.as_str()).map(String::from);
        }
        if meta.slug.is_none() {
            meta.slug = parsed.get("slug").and_then(|v| v.as_str()).map(String::from);
        }
        if meta.model.is_none() {
            meta.model = parsed.get("message").and_then(|m| m.get("model")).and_then(|v| v.as_str()).map(String::from);
        }
        if meta.first_timestamp.is_none() {
            meta.first_timestamp = parsed.get("timestamp").and_then(|v| v.as_str()).map(String::from);
        }

        if meta.version.is_some() && meta.git_branch.is_some() && meta.cwd.is_some() && meta.first_timestamp.is_some() {
            break;
        }
    }

    (session_id, meta)
}

fn resolve_all_claude_projects_dirs() -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let home_path = std::path::PathBuf::from(&home);
    let mut dirs = Vec::new();

    dirs.push(home_path.join(".claude").join("projects"));

    if let Ok(entries) = std::fs::read_dir(&home_path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with(".claude-") && entry.path().is_dir() {
                let projects_dir = entry.path().join("projects");
                if projects_dir.exists() {
                    dirs.push(projects_dir);
                }
            }
        }
    }

    dirs
}

fn resolve_project_display_name(dir_name: &str) -> String {
    let trimmed = dir_name.trim_start_matches('-');
    if trimmed.is_empty() {
        return dir_name.to_string();
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    if !home.is_empty() {
        let home_encoded = home.trim_start_matches('/').replace('/', "-");
        if let Some(remainder) = trimmed.strip_prefix(&home_encoded) {
            let remainder = remainder.trim_start_matches('-');
            if remainder.is_empty() {
                return dir_name.to_string();
            }
            let parts: Vec<&str> = remainder.split('-').collect();
            let mut current_dir = std::path::PathBuf::from(&home);
            let mut consumed = 0usize;
            for start in 0..parts.len() {
                let candidate = parts[start];
                let test_path = current_dir.join(candidate);
                if test_path.is_dir() && start + 1 < parts.len() {
                    current_dir = test_path;
                    consumed = start + 1;
                } else {
                    break;
                }
            }
            let project_name = parts[consumed..].join("-");
            if !project_name.is_empty() {
                return project_name;
            }
        }
    }

    let reconstructed = trimmed.replace('-', "/");
    std::path::Path::new(&reconstructed)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_name.to_string())
}

fn walkdir(dir: &std::path::Path, ext: &str) -> Vec<std::path::PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(walkdir(&path, ext));
            } else if path.extension().map(|e| e == ext).unwrap_or(false) {
                results.push(path);
            }
        }
    }
    results
}
