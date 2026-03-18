use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Payload emitted to the frontend via the `session-updated` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct SessionUpdatedPayload {
    /// List of JSONL file paths that changed.
    pub changed_paths: Vec<String>,
}

/// Start a background file-system watcher that monitors `~/.claude/projects/`
/// for new or modified JSONL session files.
///
/// When changes are detected, the watcher debounces them over a 2-second
/// window and then emits a `session-updated` Tauri event to the frontend
/// carrying the list of changed file paths.
///
/// Returns the `RecommendedWatcher` handle -- dropping it stops the watcher.
pub fn start_watcher(app_handle: AppHandle) -> Result<RecommendedWatcher, String> {
    let mut watch_dirs = resolve_all_claude_projects_dirs();

    // Also watch Cursor workspace storage for .vscdb changes
    let cursor_ws = crate::commands::history::resolve_cursor_workspace_storage_dir();
    if cursor_ws.exists() {
        watch_dirs.push(cursor_ws);
    }

    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = tx.send(res);
        },
        Config::default().with_poll_interval(Duration::from_secs(10)),
    )
    .map_err(|e| format!("Failed to create file watcher: {e}"))?;

    // Watch each project subdirectory non-recursively (one level deep)
    // instead of recursively watching the entire projects tree. The watcher
    // only needs to detect new/modified JSONL files at the project level.
    for watch_dir in &watch_dirs {
        if !watch_dir.exists() {
            log::warn!("Watch target does not exist yet: {}", watch_dir.display());
            continue;
        }

        // Watch the top-level projects dir itself (non-recursive) to detect new project dirs
        match watcher.watch(watch_dir, RecursiveMode::NonRecursive) {
            Ok(_) => log::info!("Watching (non-recursive): {}", watch_dir.display()),
            Err(e) => log::warn!("Failed to watch {}: {e}", watch_dir.display()),
        }

        // Watch each immediate project subdirectory non-recursively for JSONL files
        if let Ok(entries) = std::fs::read_dir(watch_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    match watcher.watch(&path, RecursiveMode::NonRecursive) {
                        Ok(_) => log::info!("Watching project dir: {}", path.display()),
                        Err(e) => log::warn!("Failed to watch {}: {e}", path.display()),
                    }
                }
            }
        }
    }

    // Spawn a thread that receives raw FS events, debounces them over a
    // 2-second window, and emits a single Tauri event with all accumulated
    // changed paths.
    std::thread::Builder::new()
        .name("file-watcher-rx".into())
        .spawn(move || {
            debounce_loop(rx, &app_handle);
        })
        .map_err(|e| format!("Failed to spawn watcher thread: {e}"))?;

    Ok(watcher)
}

/// Core debounce loop.  Collects JSONL change events over a 2-second window
/// and then emits them as a single `session-updated` event.
fn debounce_loop(
    rx: mpsc::Receiver<Result<Event, notify::Error>>,
    app_handle: &AppHandle,
) {
    const DEBOUNCE_DURATION: Duration = Duration::from_secs(2);

    let mut pending: HashSet<PathBuf> = HashSet::new();
    let mut window_start: Option<Instant> = None;

    loop {
        // If we have pending changes, use a timeout so we flush after the
        // debounce window.  Otherwise block indefinitely.
        let timeout = match window_start {
            Some(start) => {
                let elapsed = start.elapsed();
                if elapsed >= DEBOUNCE_DURATION {
                    Duration::ZERO
                } else {
                    DEBOUNCE_DURATION - elapsed
                }
            }
            None => Duration::from_secs(60 * 60), // block for up to 1 hour
        };

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                // Filter to JSONL and vscdb files (Claude Code + Cursor).
                let session_paths: Vec<PathBuf> = event
                    .paths
                    .into_iter()
                    .filter(|p| {
                        p.extension()
                            .map(|ext| ext == "jsonl" || ext == "vscdb")
                            .unwrap_or(false)
                    })
                    .collect();

                if !session_paths.is_empty() {
                    for p in session_paths {
                        pending.insert(p);
                    }
                    if window_start.is_none() {
                        window_start = Some(Instant::now());
                    }
                }
            }
            Ok(Err(e)) => {
                log::error!("File watcher error: {e}");
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Debounce window expired -- flush.
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Watcher was dropped, exit the loop.
                log::info!("File watcher channel disconnected, stopping debounce loop.");
                break;
            }
        }

        // Check if the debounce window has elapsed and we have pending paths.
        let should_flush = match window_start {
            Some(start) => start.elapsed() >= DEBOUNCE_DURATION,
            None => false,
        };

        if should_flush && !pending.is_empty() {
            let changed_paths: Vec<String> = pending
                .drain()
                .map(|p| p.to_string_lossy().to_string())
                .collect();

            log::info!(
                "File watcher emitting session-updated with {} changed path(s)",
                changed_paths.len()
            );

            let payload = SessionUpdatedPayload { changed_paths };
            if let Err(e) = app_handle.emit("session-updated", &payload) {
                log::error!("Failed to emit session-updated event: {e}");
            }

            window_start = None;
        }
    }
}

/// Collect all Claude profile project directories to watch.
fn resolve_all_claude_projects_dirs() -> Vec<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let home_path = PathBuf::from(&home);
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
