//! Agent stdout parser — translates agent output lines into coordination events.
//!
//! Agents (Claude Code, Codex) don't know about Automerge. This module uses
//! heuristics to detect when an agent starts reviewing a file, reports a finding,
//! or finishes its work, and emits structured `CoordinationEvent`s.

use serde::{Deserialize, Serialize};

/// Events parsed from agent stdout that drive CRDT state updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CoordinationEvent {
    /// Agent started working on a file.
    FileStarted { file: String },
    /// Agent found an issue.
    FindingReported {
        file: String,
        line_start: u32,
        line_end: u32,
        severity: String,
        message: String,
    },
    /// Agent reported a status/progress update.
    StatusUpdate { status: String, progress: f64 },
    /// Agent finished its work.
    Completed,
}

/// Parse a single line of agent stdout into an optional coordination event.
///
/// Uses heuristics — this is intentionally simple and will be iterated on.
pub fn parse_line(line: &str) -> Option<CoordinationEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Try JSON parsing first (Claude Code stream-json format)
    if trimmed.starts_with('{') {
        return parse_json_line(trimmed);
    }

    // Check for completion markers
    let lower = trimmed.to_lowercase();
    if lower.contains("done") && (lower.contains("review") || lower.contains("analysis"))
        || lower.starts_with("done")
        || lower.starts_with("complete")
        || lower.starts_with("finished")
    {
        return Some(CoordinationEvent::Completed);
    }

    // Check for finding patterns: "Error:", "Warning:", "Bug:", "Issue:" with file:line
    if let Some(evt) = parse_finding_line(trimmed) {
        return Some(evt);
    }

    // Check for file review patterns: "Reviewing ...", "Reading ..."
    if let Some(evt) = parse_file_started(trimmed) {
        return Some(evt);
    }

    None
}

/// Try to parse a JSON line from Claude Code's stream-json output.
fn parse_json_line(line: &str) -> Option<CoordinationEvent> {
    let parsed: serde_json::Value = serde_json::from_str(line).ok()?;

    // Claude Code stream-json: tool_use events with Read/Edit tools
    if parsed.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
        let tool_name = parsed.get("tool")
            .or_else(|| parsed.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if tool_name.contains("Read") || tool_name.contains("Edit") || tool_name.contains("View") {
            // Extract file path from the tool input
            let file = parsed
                .get("input")
                .or_else(|| parsed.get("params"))
                .and_then(|v| {
                    v.get("file_path")
                        .or_else(|| v.get("path"))
                        .or_else(|| v.get("file"))
                })
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if let Some(file) = file {
                return Some(CoordinationEvent::FileStarted { file });
            }
        }
    }

    // Claude Code stream-json: content_block with text containing file references
    if parsed.get("type").and_then(|v| v.as_str()) == Some("content_block_delta") {
        if let Some(text) = parsed
            .get("delta")
            .and_then(|d| d.get("text"))
            .and_then(|v| v.as_str())
        {
            // Check for finding patterns in streamed text
            if let Some(evt) = parse_finding_line(text) {
                return Some(evt);
            }
        }
    }

    // Claude Code stream-json: result event
    if parsed.get("type").and_then(|v| v.as_str()) == Some("result") {
        return Some(CoordinationEvent::Completed);
    }

    None
}

/// Try to extract a finding from a line containing error/warning patterns.
///
/// Looks for patterns like:
/// - "Error: src/foo.ts:42 - something wrong"
/// - "Warning in src/foo.ts:10-15: message"
/// - "Bug: [high] src/foo.ts:42 message"
fn parse_finding_line(line: &str) -> Option<CoordinationEvent> {
    let lower = line.to_lowercase();

    // Determine severity
    let severity = if lower.contains("error:") || lower.contains("bug:") {
        "error"
    } else if lower.contains("warning:") || lower.contains("warn:") {
        "warning"
    } else if lower.contains("issue:") {
        "info"
    } else {
        return None;
    };

    // Try to extract file:line reference
    // Pattern: some/path.ext:NUMBER
    let file_line_re = extract_file_line_ref(line);
    if let Some((file, line_start, line_end)) = file_line_re {
        // Extract the message — everything after the file:line reference
        let message = line
            .split(&file)
            .last()
            .unwrap_or(line)
            .trim_start_matches(|c: char| c == ':' || c == ' ' || c.is_ascii_digit() || c == '-')
            .trim()
            .to_string();

        let message = if message.is_empty() {
            line.to_string()
        } else {
            message
        };

        return Some(CoordinationEvent::FindingReported {
            file,
            line_start,
            line_end,
            severity: severity.to_string(),
            message,
        });
    }

    None
}

/// Try to extract a file:line reference from a string.
/// Returns (file_path, line_start, line_end).
fn extract_file_line_ref(text: &str) -> Option<(String, u32, u32)> {
    // Look for patterns like "path/to/file.ext:42" or "path/to/file.ext:42-50"
    for word in text.split_whitespace() {
        let clean = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '.' && c != ':' && c != '-' && c != '_');
        if let Some(colon_pos) = clean.rfind(':') {
            let path = &clean[..colon_pos];
            let line_part = &clean[colon_pos + 1..];

            // Validate it looks like a file path (has an extension or contains /)
            if (path.contains('.') || path.contains('/')) && !path.is_empty() {
                // Parse line number(s)
                if let Some(dash_pos) = line_part.find('-') {
                    let start: u32 = line_part[..dash_pos].parse().ok()?;
                    let end: u32 = line_part[dash_pos + 1..].parse().ok()?;
                    return Some((path.to_string(), start, end));
                } else if let Ok(line_num) = line_part.parse::<u32>() {
                    return Some((path.to_string(), line_num, line_num));
                }
            }
        }
    }
    None
}

/// Check if a line indicates the agent is starting to work on a file.
///
/// Matches patterns like:
/// - "Reviewing src/foo.ts"
/// - "Reading src/foo.ts"
/// - "Analyzing src/foo.ts"
fn parse_file_started(line: &str) -> Option<CoordinationEvent> {
    let lower = line.to_lowercase();
    let prefixes = ["reviewing ", "reading ", "analyzing ", "checking ", "examining ", "inspecting "];

    for prefix in &prefixes {
        if lower.starts_with(prefix) || lower.contains(&format!("now {prefix}")) {
            // Extract the file path — the first thing after the prefix that looks like a path
            let after = if lower.starts_with(prefix) {
                &line[prefix.len()..]
            } else if let Some(pos) = lower.find(&format!("now {prefix}")) {
                &line[pos + 4 + prefix.len()..]
            } else {
                continue;
            };

            let file = after
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_end_matches(|c: char| c == '.' || c == ',' || c == ':' || c == ';')
                .to_string();

            // Validate it looks like a file path
            if !file.is_empty() && (file.contains('.') || file.contains('/')) {
                return Some(CoordinationEvent::FileStarted { file });
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_file_started() {
        let evt = parse_line("Reviewing src/main.rs").unwrap();
        match evt {
            CoordinationEvent::FileStarted { file } => assert_eq!(file, "src/main.rs"),
            _ => panic!("expected FileStarted"),
        }
    }

    #[test]
    fn test_parse_finding() {
        let evt = parse_line("Error: src/foo.ts:42 - null reference possible").unwrap();
        match evt {
            CoordinationEvent::FindingReported {
                file,
                line_start,
                severity,
                ..
            } => {
                assert_eq!(file, "src/foo.ts");
                assert_eq!(line_start, 42);
                assert_eq!(severity, "error");
            }
            _ => panic!("expected FindingReported"),
        }
    }

    #[test]
    fn test_parse_completed() {
        let evt = parse_line("Done with review").unwrap();
        assert!(matches!(evt, CoordinationEvent::Completed));
    }

    #[test]
    fn test_parse_json_tool_use() {
        let json = r#"{"type":"tool_use","tool":"Read","input":{"file_path":"src/lib.rs"}}"#;
        let evt = parse_line(json).unwrap();
        match evt {
            CoordinationEvent::FileStarted { file } => assert_eq!(file, "src/lib.rs"),
            _ => panic!("expected FileStarted"),
        }
    }

    #[test]
    fn test_empty_line_returns_none() {
        assert!(parse_line("").is_none());
        assert!(parse_line("   ").is_none());
    }

    #[test]
    fn test_irrelevant_line_returns_none() {
        assert!(parse_line("Thinking about the architecture...").is_none());
    }
}
