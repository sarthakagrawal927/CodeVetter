use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single review finding reported by an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub id: String,
    pub file: String,
    pub line_start: u32,
    pub line_end: u32,
    pub severity: String,
    pub message: String,
    pub agent_id: String,
    pub timestamp: String,
}

/// Status of a single agent within a coordinated review.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatus {
    pub status: String,
    pub current_file: Option<String>,
    pub progress: f64,
}

/// A step in the review plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub step: String,
    pub owner: String,
    pub status: String,
}

/// Metadata about the review.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewMeta {
    pub repo_path: String,
    pub branch: String,
    pub created_at: String,
    pub review_id: String,
}

/// The full review state — serializable to JSON for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewState {
    pub review_id: String,
    pub findings: Vec<Finding>,
    pub files_claimed: HashMap<String, String>,
    pub agent_status: HashMap<String, AgentStatus>,
    pub plan: Vec<PlanStep>,
    pub meta: ReviewMeta,
}
