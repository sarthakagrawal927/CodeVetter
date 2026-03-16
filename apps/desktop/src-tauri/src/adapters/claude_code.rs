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
        cmd.arg("-p")
            .arg(&task_prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--model")
            .arg("sonnet")
            .current_dir(&project_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = cmd
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

        // We intentionally don't wait on the child here — it runs in the
        // background.  The caller tracks the PID and can send SIGTERM to stop.
        // The child handle is leaked intentionally; the OS will clean up when
        // the process exits.
        std::mem::forget(child);

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
