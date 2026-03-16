use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Holds the master (write) side and child process for one terminal.
struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    /// Set to true to signal the reader thread to stop.
    shutdown: Arc<std::sync::atomic::AtomicBool>,
}

/// Global map of active terminals, managed as Tauri state.
pub struct TerminalState(pub Arc<Mutex<HashMap<String, PtyHandle>>>);

/// Payload emitted to the frontend via the `terminal-output` event.
#[derive(Clone, Serialize)]
struct TerminalOutputPayload {
    terminal_id: String,
    data: String, // base64-encoded bytes
}

/// Register the global `TerminalState` during app setup.
pub fn init_terminal_state(app: &tauri::App) {
    app.manage(TerminalState(Arc::new(Mutex::new(HashMap::new()))));
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn spawn_terminal(
    cwd: String,
    terminal_id: String,
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
) -> Result<serde_json::Value, String> {
    use base64::Engine;

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Determine the user's shell.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut cmd = CommandBuilder::new(&shell);
    // Start as a login shell so the user's profile is sourced.
    cmd.arg("-l");
    cmd.cwd(&cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

    // Take a reader and writer from the master side.
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shutdown_flag = shutdown.clone();
    let tid = terminal_id.clone();

    // Spawn a background thread that reads PTY output and emits Tauri events.
    std::thread::Builder::new()
        .name(format!("pty-reader-{tid}"))
        .spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if shutdown_flag.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app.emit(
                            "terminal-output",
                            TerminalOutputPayload {
                                terminal_id: tid.clone(),
                                data: encoded,
                            },
                        );
                    }
                    Err(e) => {
                        // On macOS, EIO means the child exited.
                        if e.kind() == std::io::ErrorKind::Other
                            || e.raw_os_error() == Some(libc::EIO)
                        {
                            break;
                        }
                        log::error!("PTY read error for {tid}: {e}");
                        break;
                    }
                }
            }
        })
        .map_err(|e| format!("Failed to spawn reader thread: {e}"))?;

    let handle = PtyHandle {
        master: pair.master,
        writer,
        child,
        shutdown,
    };

    state
        .0
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?
        .insert(terminal_id.clone(), handle);

    Ok(serde_json::json!({ "terminal_id": terminal_id }))
}

#[tauri::command]
pub fn write_terminal(
    terminal_id: String,
    data: String,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let mut map = state
        .0
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    let handle = map
        .get_mut(&terminal_id)
        .ok_or_else(|| format!("Terminal not found: {terminal_id}"))?;

    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    terminal_id: String,
    cols: u32,
    rows: u32,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let map = state
        .0
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    let handle = map
        .get(&terminal_id)
        .ok_or_else(|| format!("Terminal not found: {terminal_id}"))?;

    handle
        .master
        .resize(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn close_terminal(
    terminal_id: String,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let mut map = state
        .0
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if let Some(mut handle) = map.remove(&terminal_id) {
        // Signal the reader thread to stop.
        handle
            .shutdown
            .store(true, std::sync::atomic::Ordering::Relaxed);
        // Kill the child process.
        let _ = handle.child.kill();
    }

    Ok(())
}
