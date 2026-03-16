//! Core document operations for the CRDT-based agent coordination layer.
//!
//! Uses Automerge `AutoCommit` documents as the storage layer.
//! The document schema mirrors `ReviewState` from `schema.rs`:
//!   - "findings": list of Finding objects
//!   - "files_claimed": map of file_path -> agent_id
//!   - "agent_status": map of agent_id -> AgentStatus object
//!   - "plan": list of PlanStep objects
//!   - "meta": map with repo_path, branch, created_at, review_id

use super::schema::{AgentStatus, Finding, PlanStep, ReviewMeta, ReviewState};
use automerge::{transaction::Transactable, AutoCommit, ObjId, ObjType, ReadDoc, ROOT};
use std::collections::HashMap;
use std::path::Path;

/// Create a new review document with initial metadata.
pub fn create_review_doc(repo_path: &str, branch: &str, review_id: &str) -> AutoCommit {
    let mut doc = AutoCommit::new();

    // Create top-level structures
    let _findings = doc
        .put_object(ROOT, "findings", ObjType::List)
        .expect("create findings list");

    let _files_claimed = doc
        .put_object(ROOT, "files_claimed", ObjType::Map)
        .expect("create files_claimed map");

    let _agent_status = doc
        .put_object(ROOT, "agent_status", ObjType::Map)
        .expect("create agent_status map");

    let _plan = doc
        .put_object(ROOT, "plan", ObjType::List)
        .expect("create plan list");

    let meta = doc
        .put_object(ROOT, "meta", ObjType::Map)
        .expect("create meta map");

    // Populate metadata
    let now = chrono::Utc::now().to_rfc3339();
    doc.put(&meta, "repo_path", repo_path)
        .expect("set repo_path");
    doc.put(&meta, "branch", branch).expect("set branch");
    doc.put(&meta, "created_at", now.as_str())
        .expect("set created_at");
    doc.put(&meta, "review_id", review_id)
        .expect("set review_id");

    doc
}

/// Attempt to claim a file for an agent. Returns `true` if the claim succeeded
/// (file was not previously claimed), `false` if already claimed by another agent.
pub fn claim_file(doc: &mut AutoCommit, agent_id: &str, file: &str) -> bool {
    let files_claimed = match doc.get(ROOT, "files_claimed") {
        Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
        _ => return false,
    };

    // Check if file is already claimed
    if let Ok(Some(_)) = doc.get(&files_claimed, file) {
        return false;
    }

    // Claim it
    doc.put(&files_claimed, file, agent_id)
        .expect("claim file");
    true
}

/// Add a finding to the review document.
pub fn add_finding(doc: &mut AutoCommit, finding: &Finding) {
    let findings = match doc.get(ROOT, "findings") {
        Ok(Some((automerge::Value::Object(ObjType::List), id))) => id,
        _ => return,
    };

    let len = doc.length(&findings);
    let entry = doc
        .insert_object(&findings, len, ObjType::Map)
        .expect("insert finding");

    doc.put(&entry, "id", finding.id.as_str())
        .expect("set finding id");
    doc.put(&entry, "file", finding.file.as_str())
        .expect("set finding file");
    doc.put(&entry, "line_start", finding.line_start as i64)
        .expect("set line_start");
    doc.put(&entry, "line_end", finding.line_end as i64)
        .expect("set line_end");
    doc.put(&entry, "severity", finding.severity.as_str())
        .expect("set severity");
    doc.put(&entry, "message", finding.message.as_str())
        .expect("set message");
    doc.put(&entry, "agent_id", finding.agent_id.as_str())
        .expect("set agent_id");
    doc.put(&entry, "timestamp", finding.timestamp.as_str())
        .expect("set timestamp");
}

/// Update an agent's status in the review document.
pub fn update_agent_status(doc: &mut AutoCommit, agent_id: &str, status: &AgentStatus) {
    let agent_status_map = match doc.get(ROOT, "agent_status") {
        Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
        _ => return,
    };

    // Create or update the agent's status entry
    let agent_entry = match doc.get(&agent_status_map, agent_id) {
        Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
        _ => doc
            .put_object(&agent_status_map, agent_id, ObjType::Map)
            .expect("create agent status entry"),
    };

    doc.put(&agent_entry, "status", status.status.as_str())
        .expect("set status");
    doc.put(
        &agent_entry,
        "current_file",
        status.current_file.as_deref().unwrap_or(""),
    )
    .expect("set current_file");
    doc.put(&agent_entry, "progress", status.progress)
        .expect("set progress");
}

/// Read the full state out of the Automerge document into a `ReviewState`.
pub fn get_state(doc: &AutoCommit) -> ReviewState {
    let meta = read_meta(doc);
    let findings = read_findings(doc);
    let files_claimed = read_files_claimed(doc);
    let agent_status = read_agent_status(doc);
    let plan = read_plan(doc);

    ReviewState {
        review_id: meta.review_id.clone(),
        findings,
        files_claimed,
        agent_status,
        plan,
        meta,
    }
}

/// Save the document to disk as binary automerge format.
pub fn save_to_disk(doc: &mut AutoCommit, path: &Path) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }

    let bytes = doc.save();
    std::fs::write(path, bytes).map_err(|e| format!("Failed to write doc: {e}"))
}

/// Load a document from disk.
pub fn load_from_disk(path: &Path) -> Result<AutoCommit, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read doc: {e}"))?;
    AutoCommit::load(&bytes).map_err(|e| format!("Failed to load automerge doc: {e}"))
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/// Read a string value from a map in the Automerge doc.
fn get_str(doc: &AutoCommit, obj: &ObjId, key: &str) -> String {
    match doc.get(obj, key) {
        Ok(Some((automerge::Value::Scalar(s), _))) => {
            let raw = s.to_string();
            // ScalarValue::Str Display impl may or may not quote — strip for safety
            raw.trim_matches('"').to_string()
        }
        _ => String::new(),
    }
}

/// Read a u32 value from a map in the Automerge doc.
fn get_u32_val(doc: &AutoCommit, obj: &ObjId, key: &str) -> u32 {
    match doc.get(obj, key) {
        Ok(Some((automerge::Value::Scalar(s), _))) => {
            s.to_string().trim_matches('"').parse().unwrap_or(0)
        }
        _ => 0,
    }
}

/// Read a f64 value from a map in the Automerge doc.
fn get_f64_val(doc: &AutoCommit, obj: &ObjId, key: &str) -> f64 {
    match doc.get(obj, key) {
        Ok(Some((automerge::Value::Scalar(s), _))) => {
            s.to_string().trim_matches('"').parse().unwrap_or(0.0)
        }
        _ => 0.0,
    }
}

fn read_meta(doc: &AutoCommit) -> ReviewMeta {
    let meta_id = match doc.get(ROOT, "meta") {
        Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
        _ => {
            return ReviewMeta {
                repo_path: String::new(),
                branch: String::new(),
                created_at: String::new(),
                review_id: String::new(),
            }
        }
    };

    ReviewMeta {
        repo_path: get_str(doc, &meta_id, "repo_path"),
        branch: get_str(doc, &meta_id, "branch"),
        created_at: get_str(doc, &meta_id, "created_at"),
        review_id: get_str(doc, &meta_id, "review_id"),
    }
}

fn read_findings(doc: &AutoCommit) -> Vec<Finding> {
    let findings_id = match doc.get(ROOT, "findings") {
        Ok(Some((automerge::Value::Object(ObjType::List), id))) => id,
        _ => return Vec::new(),
    };

    let len = doc.length(&findings_id);
    let mut results = Vec::with_capacity(len);

    for i in 0..len {
        let entry_id = match doc.get(&findings_id, i) {
            Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
            _ => continue,
        };

        results.push(Finding {
            id: get_str(doc, &entry_id, "id"),
            file: get_str(doc, &entry_id, "file"),
            line_start: get_u32_val(doc, &entry_id, "line_start"),
            line_end: get_u32_val(doc, &entry_id, "line_end"),
            severity: get_str(doc, &entry_id, "severity"),
            message: get_str(doc, &entry_id, "message"),
            agent_id: get_str(doc, &entry_id, "agent_id"),
            timestamp: get_str(doc, &entry_id, "timestamp"),
        });
    }

    results
}

fn read_files_claimed(doc: &AutoCommit) -> HashMap<String, String> {
    let map_id = match doc.get(ROOT, "files_claimed") {
        Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
        _ => return HashMap::new(),
    };

    let keys: Vec<String> = doc.keys(&map_id).collect();
    let mut result = HashMap::new();
    for key in keys {
        let val = get_str(doc, &map_id, &key);
        if !val.is_empty() {
            result.insert(key, val);
        }
    }
    result
}

fn read_agent_status(doc: &AutoCommit) -> HashMap<String, AgentStatus> {
    let map_id = match doc.get(ROOT, "agent_status") {
        Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
        _ => return HashMap::new(),
    };

    let keys: Vec<String> = doc.keys(&map_id).collect();
    let mut result = HashMap::new();

    for key in keys {
        let entry_id = match doc.get(&map_id, key.as_str()) {
            Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
            _ => continue,
        };

        let status_str = get_str(doc, &entry_id, "status");
        let current_file_str = get_str(doc, &entry_id, "current_file");
        let progress = get_f64_val(doc, &entry_id, "progress");

        let current_file = if current_file_str.is_empty() {
            None
        } else {
            Some(current_file_str)
        };

        result.insert(
            key,
            AgentStatus {
                status: status_str,
                current_file,
                progress,
            },
        );
    }

    result
}

fn read_plan(doc: &AutoCommit) -> Vec<PlanStep> {
    let plan_id = match doc.get(ROOT, "plan") {
        Ok(Some((automerge::Value::Object(ObjType::List), id))) => id,
        _ => return Vec::new(),
    };

    let len = doc.length(&plan_id);
    let mut results = Vec::with_capacity(len);

    for i in 0..len {
        let entry_id = match doc.get(&plan_id, i) {
            Ok(Some((automerge::Value::Object(ObjType::Map), id))) => id,
            _ => continue,
        };

        results.push(PlanStep {
            step: get_str(doc, &entry_id, "step"),
            owner: get_str(doc, &entry_id, "owner"),
            status: get_str(doc, &entry_id, "status"),
        });
    }

    results
}
