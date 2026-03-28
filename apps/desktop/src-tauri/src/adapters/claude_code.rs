use super::{AgentAdapter, AgentHandle};
use std::path::PathBuf;
use std::process::Command;

/// Claude Code CLI adapter.
///
/// Spawns `claude -p "<task>" --output-format stream-json` as a child process.
/// The process runs the task autonomously and exits when done.
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self
    }

    /// Detect whether `claude` CLI is installed and return its path.
    pub fn detect_cli() -> Option<String> {
        // Check common locations
        for path in &["claude", "/usr/local/bin/claude"] {
            if let Ok(output) = Command::new(path).arg("--version").output() {
                if output.status.success() {
                    return Some(path.to_string());
                }
            }
        }
        // Check via `which`
        if let Ok(output) = Command::new("which").arg("claude").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
        None
    }
}

impl AgentAdapter for ClaudeCodeAdapter {
    fn name(&self) -> &str {
        "claude-code"
    }

    async fn launch(
        &self,
        project_path: PathBuf,
        role: Option<String>,
        task: Option<String>,
        resume_session_id: Option<String>,
    ) -> Result<AgentHandle, String> {
        let cli_path =
            Self::detect_cli().ok_or("Claude Code CLI not found. Install it first.")?;

        let task_prompt = task.unwrap_or_else(|| {
            format!(
                "You are a {} agent working in this project. Analyze the codebase and report what you find.",
                role.as_deref().unwrap_or("general")
            )
        });

        let mut cmd = Command::new(&cli_path);

        if let Some(ref session_id) = resume_session_id {
            // Resume a previous session with a new prompt
            cmd.arg("--resume").arg(session_id);
        }

        cmd.arg("-p")
            .arg(&task_prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--model")
            .arg("sonnet")
            .current_dir(&project_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn claude CLI: {e}"))?;

        let pid = child.id();
        let agent_id = uuid::Uuid::new_v4().to_string();

        log::info!(
            "ClaudeCodeAdapter: launched agent {} (pid={}) in {}",
            agent_id,
            pid,
            project_path.display()
        );

        // Read stdout in a background thread to capture session_id
        let stdout = child.stdout.take();
        let agent_id_clone = agent_id.clone();
        if let Some(stdout) = stdout {
            std::thread::Builder::new()
                .name(format!("agent-stdout-{}", &agent_id_clone[..8]))
                .spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stdout);
                    for line in reader.lines() {
                        match line {
                            Ok(l) => {
                                // Try to extract session_id from stream-json output
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&l) {
                                    if let Some(sid) = parsed.get("session_id").and_then(|v| v.as_str()) {
                                        log::info!("Agent {} session_id: {}", agent_id_clone, sid);
                                        // Store session_id — we'll update the DB from the monitor thread
                                        // For now, write to a temp file that the monitor can read
                                        let marker_path = std::env::temp_dir()
                                            .join(format!("codevetter-agent-{}.session", agent_id_clone));
                                        let _ = std::fs::write(&marker_path, sid);
                                    }
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    // Wait for the child to exit
                    let _ = child.wait();
                })
                .ok();
        } else {
            std::mem::forget(child);
        }

        Ok(AgentHandle {
            agent_id,
            pid: Some(pid),
            project_path,
            adapter_name: self.name().to_string(),
        })
    }

    async fn stop(&self, handle: &AgentHandle) -> Result<(), String> {
        if let Some(pid) = handle.pid {
            log::info!(
                "ClaudeCodeAdapter: stopping agent {} (pid={})",
                handle.agent_id,
                pid
            );
            #[cfg(unix)]
            {
                // Send SIGTERM for graceful shutdown.
                let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                if result != 0 {
                    let err = std::io::Error::last_os_error();
                    // ESRCH means process already gone — not an error.
                    if err.raw_os_error() != Some(libc::ESRCH) {
                        return Err(format!("Failed to send SIGTERM to pid {pid}: {err}"));
                    }
                }
            }
            #[cfg(not(unix))]
            {
                log::warn!("stop not implemented on non-Unix platforms");
            }
        }
        Ok(())
    }

    async fn is_running(&self, handle: &AgentHandle) -> bool {
        if let Some(pid) = handle.pid {
            #[cfg(unix)]
            {
                // kill(pid, 0) checks if the process exists without sending a signal.
                unsafe { libc::kill(pid as i32, 0) == 0 }
            }
            #[cfg(not(unix))]
            {
                let _ = pid;
                false
            }
        } else {
            false
        }
    }
}
