pub mod claude_code;
pub mod codex;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Represents the outcome of launching an agent process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHandle {
    /// Internal identifier we assigned.
    pub agent_id: String,
    /// OS-level process ID (if we managed to spawn).
    pub pid: Option<u32>,
    /// Working directory of the agent.
    pub project_path: PathBuf,
    /// Which adapter spawned it.
    pub adapter_name: String,
}

/// Trait every agent adapter must implement.
///
/// Phase 1 ships with stub implementations that return placeholder data.
/// Phases 2-4 fill them in with real CLI orchestration.
#[allow(async_fn_in_trait)]
pub trait AgentAdapter: Send + Sync {
    /// Human-readable name of the adapter (e.g. "claude-code", "codex").
    fn name(&self) -> &str;

    /// Spawn an agent process in the given project directory, optionally
    /// scoped to a role and initial task prompt.
    /// If `resume_session_id` is provided, continue a previous session.
    async fn launch(
        &self,
        project_path: PathBuf,
        role: Option<String>,
        task: Option<String>,
        resume_session_id: Option<String>,
    ) -> Result<AgentHandle, String>;

    /// Gracefully stop a running agent by its ID / PID.
    async fn stop(&self, handle: &AgentHandle) -> Result<(), String>;

    /// Return true if the underlying process is still alive.
    #[allow(dead_code)]
    async fn is_running(&self, handle: &AgentHandle) -> bool;
}
