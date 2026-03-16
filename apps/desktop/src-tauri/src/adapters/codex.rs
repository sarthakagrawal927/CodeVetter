use super::{AgentAdapter, AgentHandle};
use std::path::PathBuf;
use std::process::Command;

/// OpenAI Codex CLI adapter.
///
/// Spawns `codex -q "<task>"` as a child process.
pub struct CodexAdapter;

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }

    /// Detect whether `codex` CLI is installed.
    pub fn detect_cli() -> Option<String> {
        for path in &["codex", "/usr/local/bin/codex"] {
            if let Ok(output) = Command::new(path).arg("--version").output() {
                if output.status.success() {
                    return Some(path.to_string());
                }
            }
        }
        if let Ok(output) = Command::new("which").arg("codex").output() {
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

impl AgentAdapter for CodexAdapter {
    fn name(&self) -> &str {
        "codex"
    }

    async fn launch(
        &self,
        project_path: PathBuf,
        role: Option<String>,
        task: Option<String>,
    ) -> Result<AgentHandle, String> {
        let cli_path =
            Self::detect_cli().ok_or("Codex CLI not found. Install it first.")?;

        let task_prompt = task.unwrap_or_else(|| {
            format!(
                "You are a {} agent working in this project. Analyze the codebase and report what you find.",
                role.as_deref().unwrap_or("general")
            )
        });

        let mut cmd = Command::new(&cli_path);
        cmd.arg("-q")
            .arg(&task_prompt)
            .current_dir(&project_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn codex CLI: {e}"))?;

        let pid = child.id();
        let agent_id = uuid::Uuid::new_v4().to_string();

        log::info!(
            "CodexAdapter: launched agent {} (pid={}) in {}",
            agent_id,
            pid,
            project_path.display()
        );

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
                "CodexAdapter: stopping agent {} (pid={})",
                handle.agent_id,
                pid
            );
            #[cfg(unix)]
            {
                let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                if result != 0 {
                    let err = std::io::Error::last_os_error();
                    if err.raw_os_error() != Some(libc::ESRCH) {
                        return Err(format!("Failed to send SIGTERM to pid {pid}: {err}"));
                    }
                }
            }
        }
        Ok(())
    }

    async fn is_running(&self, handle: &AgentHandle) -> bool {
        if let Some(pid) = handle.pid {
            #[cfg(unix)]
            {
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
