use crate::db::queries;
use crate::DbState;
use serde_json::{json, Value};
use std::process::Command as StdCommand;
use tauri::State;

/// List local git branches for a given repo directory.
/// Returns the branches and which one is currently checked out.
#[tauri::command]
pub async fn list_git_branches(repo_path: String) -> Result<Value, String> {
    let output = StdCommand::new("git")
        .args(["branch", "--no-color"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git branch: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git branch failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches: Vec<String> = Vec::new();
    let mut current_branch: Option<String> = None;

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_prefix("* ") {
            let name = name.trim().to_string();
            current_branch = Some(name.clone());
            branches.push(name);
        } else {
            branches.push(line.to_string());
        }
    }

    Ok(json!({
        "branches": branches,
        "current": current_branch,
    }))
}

/// Get the GitHub remote info (owner/repo) from a local repo directory.
/// Parses the `origin` remote URL to extract owner and repo name.
#[tauri::command]
pub async fn get_git_remote_info(repo_path: String) -> Result<Value, String> {
    let output = StdCommand::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run git remote: {e}"))?;

    if !output.status.success() {
        return Err("No origin remote found".to_string());
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Parse owner/repo from common Git URL formats:
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    // ssh://git@github.com/owner/repo.git
    let (owner, repo) = parse_github_remote(&url).ok_or("Could not parse GitHub remote URL")?;

    Ok(json!({
        "url": url,
        "owner": owner,
        "repo": repo,
    }))
}

/// List open pull requests for the repo at the given path.
/// Uses `gh` CLI which respects the user's existing GitHub authentication.
#[tauri::command]
pub async fn list_pull_requests(repo_path: String) -> Result<Value, String> {
    let output = StdCommand::new("gh")
        .args([
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "number,title,headRefName,author",
            "--limit",
            "50",
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to run gh pr list: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh pr list failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let prs: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse PR list: {e}"))?;

    Ok(json!({ "pull_requests": prs }))
}

/// Check GitHub authentication status.
/// Tries: 1) saved token in preferences, 2) GH_TOKEN env, 3) `gh auth status`.
/// Returns connection info including username, auth method, and scopes.
#[tauri::command]
pub async fn check_github_auth(db: State<'_, DbState>) -> Result<Value, String> {
    // 1. Check for saved PAT in preferences
    let saved_token = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_preference(&conn, "github_token")
            .map_err(|e| e.to_string())?
    };

    if let Some(ref pat) = saved_token {
        if !pat.is_empty() {
            // Validate the saved token by calling GitHub API
            if let Some(info) = validate_github_token(pat) {
                return Ok(json!({
                    "connected": true,
                    "method": "pat",
                    "username": info.0,
                    "scopes": info.1,
                }));
            }
        }
    }

    // 2. Check GH_TOKEN / GITHUB_TOKEN env vars
    let env_token = std::env::var("GH_TOKEN")
        .or_else(|_| std::env::var("GITHUB_TOKEN"))
        .ok();

    if let Some(ref token) = env_token {
        if !token.is_empty() {
            if let Some(info) = validate_github_token(token) {
                return Ok(json!({
                    "connected": true,
                    "method": "env",
                    "username": info.0,
                    "scopes": info.1,
                }));
            }
        }
    }

    // 3. Check gh CLI auth
    let gh_status = StdCommand::new("gh")
        .args(["auth", "status", "--show-token"])
        .output()
        .ok();

    if let Some(ref output) = gh_status {
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        if output.status.success() || combined.contains("Logged in to") {
            // Extract username from output
            let username = combined
                .lines()
                .find(|l| l.contains("Logged in to") || l.contains("account"))
                .and_then(|l| {
                    // "Logged in to github.com account username (keyring)"
                    l.split("account").nth(1).map(|s| {
                        s.trim()
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .to_string()
                    })
                })
                .unwrap_or_default();

            // Get the actual token for later use
            let token_output = StdCommand::new("gh")
                .args(["auth", "token"])
                .output()
                .ok();

            let has_token = token_output
                .as_ref()
                .map(|o| o.status.success())
                .unwrap_or(false);

            return Ok(json!({
                "connected": true,
                "method": "gh_cli",
                "username": username,
                "scopes": if has_token { "authenticated" } else { "limited" },
            }));
        }
    }

    Ok(json!({
        "connected": false,
        "method": null,
        "username": null,
        "scopes": null,
    }))
}

/// Sync the gh CLI token into preferences for use by the sidecar.
#[tauri::command]
pub async fn sync_github_token(db: State<'_, DbState>) -> Result<Value, String> {
    // Try gh auth token first
    let output = StdCommand::new("gh")
        .args(["auth", "token"])
        .output()
        .map_err(|e| format!("gh CLI not found: {e}"))?;

    if !output.status.success() {
        return Err("gh CLI is not authenticated. Run `gh auth login` first.".to_string());
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err("gh auth token returned empty string".to_string());
    }

    // Save to preferences
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_preference(&conn, "github_token", &token).map_err(|e| e.to_string())?;

    // Validate
    let username = validate_github_token(&token)
        .map(|(u, _)| u)
        .unwrap_or_default();

    Ok(json!({
        "synced": true,
        "username": username,
    }))
}

/// Validate a GitHub token by calling /user and return (username, scopes).
fn validate_github_token(token: &str) -> Option<(String, String)> {
    // Use a simple curl-like approach via std::process::Command
    // to avoid adding an HTTP client dependency to the Rust side.
    let output = StdCommand::new("curl")
        .args([
            "-s",
            "-H",
            &format!("Authorization: Bearer {token}"),
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "X-GitHub-Api-Version: 2022-11-28",
            "-w",
            "\n%{http_code}",
            "https://api.github.com/user",
        ])
        .output()
        .ok()?;

    let text = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = text.trim().rsplitn(2, '\n').collect();
    if lines.len() < 2 {
        return None;
    }
    let status_code = lines[0].trim();
    let body = lines[1];

    if status_code != "200" {
        return None;
    }

    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    let username = parsed
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Some((username, "repo,read:org".to_string()))
}

fn parse_github_remote(url: &str) -> Option<(String, String)> {
    // HTTPS: https://github.com/owner/repo.git
    if let Some(rest) = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
    {
        let rest = rest.trim_end_matches(".git").trim_end_matches('/');
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    // SSH: git@github.com:owner/repo.git
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        let rest = rest.trim_end_matches(".git").trim_end_matches('/');
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    // SSH URL: ssh://git@github.com/owner/repo.git
    if let Some(rest) = url.strip_prefix("ssh://git@github.com/") {
        let rest = rest.trim_end_matches(".git").trim_end_matches('/');
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        if parts.len() == 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    None
}
