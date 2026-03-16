use crate::db::queries::{self, ProviderAccountRow};
use crate::DbState;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn list_provider_accounts(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let accounts = queries::list_provider_accounts(&conn).map_err(|e| e.to_string())?;
    Ok(json!({ "accounts": accounts }))
}

#[tauri::command]
pub async fn create_provider_account(
    db: State<'_, DbState>,
    name: String,
    provider: String,
    api_key: Option<String>,
    monthly_limit: Option<f64>,
    plan: Option<String>,
    weekly_limit: Option<f64>,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let account = ProviderAccountRow {
        id: id.clone(),
        name,
        provider,
        api_key,
        monthly_limit,
        plan,
        weekly_limit,
        created_at: now.clone(),
        updated_at: now,
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::create_provider_account(&conn, &account).map_err(|e| e.to_string())?;

    Ok(json!({ "id": id, "account": account }))
}

#[tauri::command]
pub async fn update_provider_account(
    db: State<'_, DbState>,
    id: String,
    name: String,
    provider: String,
    api_key: Option<String>,
    monthly_limit: Option<f64>,
    plan: Option<String>,
    weekly_limit: Option<f64>,
) -> Result<Value, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let account = ProviderAccountRow {
        id: id.clone(),
        name,
        provider,
        api_key,
        monthly_limit,
        plan,
        weekly_limit,
        created_at: String::new(),
        updated_at: now,
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::update_provider_account(&conn, &account).map_err(|e| e.to_string())?;

    Ok(json!({ "id": id }))
}

#[tauri::command]
pub async fn delete_provider_account(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::delete_provider_account(&conn, &id).map_err(|e| e.to_string())?;
    Ok(json!({ "deleted": true }))
}

/// Compute usage breakdown for an account: current session + this week.
///
/// Uses last week's usage as the baseline for percentage calculations
/// (self-calibrating). If the user has set an explicit weekly_limit,
/// that takes precedence.
#[tauri::command]
pub async fn check_account_usage(
    db: State<'_, DbState>,
    account_id: String,
) -> Result<Value, String> {
    let account = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let accounts = queries::list_provider_accounts(&conn).map_err(|e| e.to_string())?;
        accounts
            .into_iter()
            .find(|a| a.id == account_id)
            .ok_or_else(|| "Account not found".to_string())?
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let agent_type = match account.provider.as_str() {
        "openai" => "codex",
        "google" => "gemini",
        _ => "claude-code",
    };

    let now = chrono::Utc::now();

    use chrono::{Datelike, Duration};
    let today = now.date_naive();
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    let week_start_str = format!("{}T00:00:00Z", monday.format("%Y-%m-%d"));

    let last_monday = monday - Duration::days(7);
    let last_week_start = format!("{}T00:00:00Z", last_monday.format("%Y-%m-%d"));

    // Day of week: 1=Mon .. 7=Sun
    let day_of_week = today.weekday().num_days_from_monday() + 1; // 1-indexed

    // ── This week cost + tokens ─────────────────────────────────────────
    let (week_cost, week_input, week_output, week_sessions): (f64, i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0),
                    COALESCE(SUM(total_input_tokens), 0),
                    COALESCE(SUM(total_output_tokens), 0),
                    COUNT(*)
             FROM cc_sessions
             WHERE agent_type = ?1 AND last_message >= ?2",
            rusqlite::params![agent_type, week_start_str],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap_or((0.0, 0, 0, 0));

    // ── Last week cost (baseline for percentage) ────────────────────────
    let last_week_cost: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0)
             FROM cc_sessions
             WHERE agent_type = ?1 AND last_message >= ?2 AND last_message < ?3",
            rusqlite::params![agent_type, last_week_start, week_start_str],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    // ── 4-week average (more stable baseline) ───────────────────────────
    let four_weeks_ago = monday - Duration::days(28);
    let four_week_start = format!("{}T00:00:00Z", four_weeks_ago.format("%Y-%m-%d"));
    let four_week_total: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0)
             FROM cc_sessions
             WHERE agent_type = ?1 AND last_message >= ?2 AND last_message < ?3",
            rusqlite::params![agent_type, four_week_start, week_start_str],
            |row| row.get(0),
        )
        .unwrap_or(0.0);
    let avg_week_cost = if four_week_total > 0.0 {
        four_week_total / 4.0
    } else {
        last_week_cost
    };

    // ── Baseline: user-set limit > avg weekly > last week ───────────────
    let baseline = account
        .weekly_limit
        .or_else(|| if avg_week_cost > 0.0 { Some(avg_week_cost) } else { None })
        .or_else(|| if last_week_cost > 0.0 { Some(last_week_cost) } else { None });

    let week_pct = baseline.map(|b| if b > 0.0 { (week_cost / b * 100.0) } else { 0.0 });
    let week_remaining = baseline.map(|b| (b - week_cost).max(0.0));

    // ── Expected pace: what % of the week has elapsed ───────────────────
    let expected_pct = (day_of_week as f64 / 7.0) * 100.0;

    // ── Current / latest session with meaningful activity ────────────────
    let (session_cost, session_input, session_output, session_id, session_messages): (f64, i64, i64, Option<String>, i64) = conn
        .query_row(
            "SELECT estimated_cost_usd, total_input_tokens, total_output_tokens, id, message_count
             FROM cc_sessions
             WHERE agent_type = ?1 AND message_count > 0
             ORDER BY last_message DESC
             LIMIT 1",
            rusqlite::params![agent_type],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .unwrap_or((0.0, 0, 0, None, 0));

    // ── Today's cost ────────────────────────────────────────────────────
    let today_start = format!("{}T00:00:00Z", today.format("%Y-%m-%d"));
    let today_cost: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0)
             FROM cc_sessions
             WHERE agent_type = ?1 AND last_message >= ?2",
            rusqlite::params![agent_type, today_start],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    Ok(json!({
        "account_id": account.id,
        "provider": account.provider,
        "plan": account.plan,
        // Baseline (what we compare against)
        "weekly_baseline": baseline,
        "baseline_source": if account.weekly_limit.is_some() { "custom" }
                          else if avg_week_cost > 0.0 { "avg_4w" }
                          else if last_week_cost > 0.0 { "last_week" }
                          else { "none" },
        "last_week_cost": last_week_cost,
        "avg_week_cost": avg_week_cost,
        // This week
        "week_cost": week_cost,
        "week_input_tokens": week_input,
        "week_output_tokens": week_output,
        "week_sessions": week_sessions,
        "week_pct": week_pct,
        "week_remaining": week_remaining,
        // Pace
        "day_of_week": day_of_week,
        "expected_pct": expected_pct,
        // Today
        "today_cost": today_cost,
        // Latest session
        "session_cost": session_cost,
        "session_input_tokens": session_input,
        "session_output_tokens": session_output,
        "session_messages": session_messages,
        "session_id": session_id,
    }))
}

/// Default weekly limit hint for newly detected accounts.
/// Only used for initial auto-creation; not used for usage calculations
/// (those use the 4-week average as baseline instead).
fn default_weekly_limit(_provider: &str, _plan: Option<&str>) -> Option<f64> {
    // Don't set a default — let the 4-week average be the baseline.
    // Users can override via settings.
    None
}

// ─── Auto-detection ──────────────────────────────────────────────────────────

/// Detected account info from CLI auth.
#[derive(Debug, Clone, serde::Serialize)]
struct DetectedAccount {
    provider: String,
    name: String,
    email: Option<String>,
    org_id: Option<String>,
    org_name: Option<String>,
    plan: Option<String>,
}

/// Auto-detect configured accounts from Claude Code and Codex CLIs.
///
/// - Claude Code: runs `claude auth status` and parses the JSON output
/// - Codex: reads `~/.codex/auth.json` and decodes the JWT id_token
///
/// Returns detected accounts and auto-creates any that don't already exist in the DB.
#[tauri::command]
pub async fn detect_provider_accounts(db: State<'_, DbState>) -> Result<Value, String> {
    let mut detected: Vec<DetectedAccount> = Vec::new();

    // ── Detect Claude Code accounts (supports multiple keychain entries) ─
    let claude_accounts = detect_claude_accounts().await;
    detected.extend(claude_accounts);

    // ── Detect Codex / OpenAI accounts ───────────────────────────────────
    if let Some(acc) = detect_codex().await {
        detected.push(acc);
    }

    // ── Detect Gemini / Google accounts ──────────────────────────────────
    if let Some(acc) = detect_gemini().await {
        detected.push(acc);
    }

    // ── Auto-create accounts that don't already exist ────────────────────
    let mut created = 0;
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let existing = queries::list_provider_accounts(&conn).map_err(|e| e.to_string())?;

        // Clean up stale Anthropic accounts: if we detected keychain entries,
        // remove any existing Anthropic accounts whose api_key doesn't match
        // any detected keychain service name (e.g. old entries from `claude auth status`
        // that used orgId as api_key).
        let detected_anthropic_keys: Vec<&str> = detected
            .iter()
            .filter(|d| d.provider == "anthropic")
            .filter_map(|d| d.org_id.as_deref())
            .collect();
        if !detected_anthropic_keys.is_empty() {
            for existing_acc in &existing {
                if existing_acc.provider == "anthropic" {
                    let key_matches = existing_acc
                        .api_key
                        .as_deref()
                        .map_or(false, |k| detected_anthropic_keys.contains(&k));
                    if !key_matches {
                        let _ = queries::delete_provider_account(&conn, &existing_acc.id);
                    }
                }
            }
        }

        // Re-fetch after cleanup
        let existing = queries::list_provider_accounts(&conn).map_err(|e| e.to_string())?;

        for det in &detected {
            // Check if an account with same provider + org_id already exists
            let already_exists = existing.iter().any(|e| {
                e.provider == det.provider
                    && det
                        .org_id
                        .as_ref()
                        .map_or(e.name == det.name, |oid| e.api_key.as_deref() == Some(oid))
            });

            if !already_exists {
                let now = chrono::Utc::now().to_rfc3339();
                let weekly = default_weekly_limit(&det.provider, det.plan.as_deref());
                let account = ProviderAccountRow {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: det.name.clone(),
                    provider: det.provider.clone(),
                    api_key: det.org_id.clone(), // Store org_id for dedup
                    monthly_limit: None,
                    plan: det.plan.clone(),
                    weekly_limit: weekly,
                    created_at: now.clone(),
                    updated_at: now,
                };
                let _ = queries::create_provider_account(&conn, &account);
                created += 1;
            } else {
                // Update plan + weekly_limit on existing account if plan changed
                for existing_acc in &existing {
                    if existing_acc.provider == det.provider {
                        let matches = det
                            .org_id
                            .as_ref()
                            .map_or(existing_acc.name == det.name, |oid| {
                                existing_acc.api_key.as_deref() == Some(oid)
                            });
                        if matches && existing_acc.plan.as_deref() != det.plan.as_deref() {
                            let now = chrono::Utc::now().to_rfc3339();
                            let weekly = existing_acc.weekly_limit.or_else(|| {
                                default_weekly_limit(&det.provider, det.plan.as_deref())
                            });
                            let updated = ProviderAccountRow {
                                id: existing_acc.id.clone(),
                                name: existing_acc.name.clone(),
                                provider: existing_acc.provider.clone(),
                                api_key: existing_acc.api_key.clone(),
                                monthly_limit: existing_acc.monthly_limit,
                                plan: det.plan.clone(),
                                weekly_limit: weekly,
                                created_at: String::new(),
                                updated_at: now,
                            };
                            let _ = queries::update_provider_account(&conn, &updated);
                        }
                    }
                }
            }
        }
    }

    // Return fresh list
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let accounts = queries::list_provider_accounts(&conn).map_err(|e| e.to_string())?;

    Ok(json!({
        "detected": detected,
        "created": created,
        "accounts": accounts,
    }))
}

/// Detect all Claude Code accounts from macOS Keychain entries.
///
/// Scans for all `Claude Code-credentials*` keychain items, deduplicates
/// by subscription type (keeping the freshest token), and returns one
/// `DetectedAccount` per unique plan. The keychain service name is stored
/// as `org_id` so it can be passed back as `credential_key` later.
async fn detect_claude_accounts() -> Vec<DetectedAccount> {
    let services = tokio::task::spawn_blocking(find_claude_keychain_services)
        .await
        .unwrap_or_default();

    // Collect entries, dedup by subscription type (keep freshest token)
    let mut best_per_plan: std::collections::HashMap<String, (DetectedAccount, i64)> =
        std::collections::HashMap::new();

    for service in services {
        let svc = service.clone();
        let result = tokio::task::spawn_blocking(move || read_keychain_account_info(&svc))
            .await
            .ok()
            .flatten();
        if let Some((det, expires_at)) = result {
            let plan = det.plan.clone().unwrap_or_default();
            let entry = best_per_plan.entry(plan);
            use std::collections::hash_map::Entry;
            match entry {
                Entry::Vacant(e) => {
                    e.insert((det, expires_at));
                }
                Entry::Occupied(mut e) => {
                    if expires_at > e.get().1 {
                        e.insert((det, expires_at));
                    }
                }
            }
        }
    }

    best_per_plan.into_values().map(|(det, _)| det).collect()
}

/// Detect Gemini CLI account from `~/.gemini/oauth_creds.json`.
async fn detect_gemini() -> Option<DetectedAccount> {
    let home = std::env::var("HOME").ok()?;
    let creds_path = std::path::PathBuf::from(&home).join(".gemini/oauth_creds.json");

    let content = tokio::fs::read_to_string(&creds_path).await.ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    // Decode id_token to get email
    let id_token = parsed.get("id_token")?.as_str()?;
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }

    let payload_b64 = parts[1];
    let padded = match payload_b64.len() % 4 {
        2 => format!("{}==", payload_b64),
        3 => format!("{}=", payload_b64),
        _ => payload_b64.to_string(),
    };
    let replaced = padded.replace('-', "+").replace('_', "/");
    let decoded = base64_decode(&replaced)?;
    let payload: serde_json::Value = serde_json::from_slice(&decoded).ok()?;

    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .map(String::from);
    let name = email
        .clone()
        .map(|e| format!("Gemini - {}", e))
        .unwrap_or_else(|| "Gemini CLI".to_string());

    Some(DetectedAccount {
        provider: "google".to_string(),
        name,
        email,
        org_id: None,
        org_name: None,
        plan: Some("personal".to_string()),
    })
}

/// Detect Codex / OpenAI account from `~/.codex/auth.json`.
async fn detect_codex() -> Option<DetectedAccount> {
    let home = std::env::var("HOME").ok()?;
    let auth_path = std::path::PathBuf::from(&home).join(".codex/auth.json");

    let content = tokio::fs::read_to_string(&auth_path).await.ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    let id_token = parsed
        .get("tokens")?
        .get("id_token")?
        .as_str()?;

    // Decode JWT payload (base64url, no verification needed — local file)
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }

    let payload_b64 = parts[1];
    // base64url decode
    let padded = match payload_b64.len() % 4 {
        2 => format!("{}==", payload_b64),
        3 => format!("{}=", payload_b64),
        _ => payload_b64.to_string(),
    };
    let replaced = padded.replace('-', "+").replace('_', "/");
    let decoded_bytes = base64_decode(&replaced)?;
    let payload: serde_json::Value =
        serde_json::from_slice(&decoded_bytes).ok()?;

    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .map(String::from);
    let plan = payload
        .get("https://api.openai.com/auth")
        .and_then(|v| v.get("chatgpt_plan_type"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let orgs = payload
        .get("https://api.openai.com/auth")
        .and_then(|v| v.get("organizations"))
        .and_then(|v| v.as_array());

    let (org_id, org_name) = if let Some(orgs) = orgs {
        let first = orgs.first();
        (
            first.and_then(|o| o.get("id")).and_then(|v| v.as_str()).map(String::from),
            first.and_then(|o| o.get("title")).and_then(|v| v.as_str()).map(String::from),
        )
    } else {
        (None, None)
    };

    let display_name = org_name
        .clone()
        .or_else(|| email.clone())
        .unwrap_or_else(|| "Codex".to_string());

    // Prefix with "Codex" to distinguish from Claude
    let name = if display_name == "Personal" {
        format!("Codex — {}", display_name)
    } else {
        display_name
    };

    Some(DetectedAccount {
        provider: "openai".to_string(),
        name,
        email,
        org_id,
        org_name,
        plan,
    })
}

// ─── Live Usage Check ────────────────────────────────────────────────────────

/// Read the Claude Code OAuth access token from macOS Keychain.
///
/// `service` — the keychain service name, e.g. "Claude Code-credentials"
/// or "Claude Code-credentials-f50ce9b7" for a secondary account.
fn read_oauth_token_from_keychain(service: &str) -> Result<String, String> {
    let output = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            service,
            "-w",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run security command: {e}"))?;

    if !output.status.success() {
        return Err(format!("No credentials found in Keychain for '{service}'"));
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse keychain JSON: {e}"))?;

    parsed
        .get("claudeAiOauth")
        .and_then(|o| o.get("accessToken"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| "No accessToken in keychain credentials".to_string())
}

/// Scan macOS Keychain for all Claude Code credential entries.
fn find_claude_keychain_services() -> Vec<String> {
    let output = std::process::Command::new("security")
        .args(["dump-keychain"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .ok();

    let stdout = output
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut services = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        // Only match the canonical "svce"<blob>="..." line to avoid double-counting
        // (each entry also has a `0x00000007 <blob>=` line with the same value)
        if !trimmed.starts_with("\"svce\"") {
            continue;
        }
        if let Some(start) = trimmed.find("\"Claude Code-credentials") {
            let rest = &trimmed[start + 1..]; // skip opening quote
            if let Some(end) = rest.find('"') {
                let service = rest[..end].to_string();
                if !services.contains(&service) {
                    services.push(service);
                }
            }
        }
    }

    // Ensure the default one is tried even if dump-keychain fails
    if services.is_empty() {
        services.push("Claude Code-credentials".to_string());
    }

    services
}

/// Read account metadata + expiry from a specific Claude keychain entry.
/// Returns `(DetectedAccount, expires_at_ms)` for dedup by freshest token.
fn read_keychain_account_info(service: &str) -> Option<(DetectedAccount, i64)> {
    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", service, "-w"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: Value = serde_json::from_str(&raw).ok()?;

    let oauth = parsed.get("claudeAiOauth")?;
    let subscription_type = oauth
        .get("subscriptionType")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let expires_at = oauth
        .get("expiresAt")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let name = match subscription_type.as_str() {
        "team" => "Claude Team".to_string(),
        "max" => "Claude Max".to_string(),
        "pro" => "Claude Pro".to_string(),
        _ => format!("Claude ({})", subscription_type),
    };

    Some((
        DetectedAccount {
            provider: "anthropic".to_string(),
            name,
            email: None,
            org_id: Some(service.to_string()),
            org_name: None,
            plan: Some(subscription_type),
        },
        expires_at,
    ))
}

/// Check live usage for any supported provider.
///
/// - **Anthropic**: minimal API call, reads `anthropic-ratelimit-unified-*` headers.
/// - **OpenAI (Codex)**: calls `GET chatgpt.com/backend-api/wham/usage`.
/// - **Google (Gemini)**: not yet supported (token refresh complexity).
///
/// `credential_key` — for Anthropic, the keychain service name
/// (e.g. "Claude Code-credentials-f50ce9b7"). Defaults to "Claude Code-credentials".
#[tauri::command]
pub async fn check_live_usage(
    provider: String,
    credential_key: Option<String>,
) -> Result<Value, String> {
    match provider.as_str() {
        "anthropic" => check_live_usage_anthropic(credential_key).await,
        "openai" => check_live_usage_openai().await,
        "google" => Ok(json!({
            "supported": false,
            "reason": "Gemini live usage check coming soon (requires Google token refresh)"
        })),
        _ => Ok(json!({
            "supported": false,
            "reason": format!("Unknown provider: {}", provider)
        })),
    }
}

/// Anthropic live usage: make a tiny API call, read rate-limit headers.
async fn check_live_usage_anthropic(credential_key: Option<String>) -> Result<Value, String> {
    let service = credential_key.unwrap_or_else(|| "Claude Code-credentials".to_string());
    let svc = service.clone();
    let token = tokio::task::spawn_blocking(move || read_oauth_token_from_keychain(&svc))
        .await
        .map_err(|e| format!("spawn error: {e}"))??;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages?beta=true")
        .header("Authorization", format!("Bearer {}", token))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("anthropic-dangerous-direct-browser-access", "true")
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(r#"{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}"#)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    let status_code = resp.status().as_u16();
    if status_code == 401 {
        return Err(format!(
            "OAuth token expired or invalid for '{}'. Re-authenticate with Claude Code.",
            service
        ));
    }

    let headers = resp.headers().clone();

    let h = |name: &str| -> Option<String> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(String::from)
    };
    let h_f64 = |name: &str| -> Option<f64> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<f64>().ok())
    };
    let h_i64 = |name: &str| -> Option<i64> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i64>().ok())
    };

    let unified_status = h("anthropic-ratelimit-unified-status");
    let five_h_utilization = h_f64("anthropic-ratelimit-unified-5h-utilization");
    let five_h_reset = h_i64("anthropic-ratelimit-unified-5h-reset");
    let five_h_status = h("anthropic-ratelimit-unified-5h-status");
    let seven_d_utilization = h_f64("anthropic-ratelimit-unified-7d-utilization");
    let seven_d_reset = h_i64("anthropic-ratelimit-unified-7d-reset");
    let seven_d_status = h("anthropic-ratelimit-unified-7d-status");
    let representative_claim = h("anthropic-ratelimit-unified-representative-claim");
    let overage_status = h("anthropic-ratelimit-unified-overage-status");
    let overage_disabled_reason = h("anthropic-ratelimit-unified-overage-disabled-reason");
    let fallback_pct = h_f64("anthropic-ratelimit-unified-fallback-percentage");

    let now_epoch = chrono::Utc::now().timestamp();
    let five_h_resets_in = five_h_reset.map(|r| (r - now_epoch).max(0));
    let seven_d_resets_in = seven_d_reset.map(|r| (r - now_epoch).max(0));

    Ok(json!({
        "supported": true,
        "status": unified_status.unwrap_or_else(|| "unknown".to_string()),
        "five_h": {
            "utilization": five_h_utilization,
            "utilization_pct": five_h_utilization.map(|u| (u * 100.0).round()),
            "reset_at": five_h_reset,
            "resets_in_secs": five_h_resets_in,
            "status": five_h_status,
        },
        "seven_d": {
            "utilization": seven_d_utilization,
            "utilization_pct": seven_d_utilization.map(|u| (u * 100.0).round()),
            "reset_at": seven_d_reset,
            "resets_in_secs": seven_d_resets_in,
            "status": seven_d_status,
        },
        "representative_claim": representative_claim,
        "overage_status": overage_status,
        "overage_disabled_reason": overage_disabled_reason,
        "fallback_pct": fallback_pct,
        "checked_at": chrono::Utc::now().to_rfc3339(),
    }))
}

/// OpenAI (Codex) live usage: call the WHAM usage endpoint.
async fn check_live_usage_openai() -> Result<Value, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let auth_path = format!("{}/.codex/auth.json", home);
    let content = tokio::fs::read_to_string(&auth_path)
        .await
        .map_err(|e| format!("Failed to read ~/.codex/auth.json: {e}"))?;
    let parsed: Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse codex auth: {e}"))?;

    let access_token = parsed
        .pointer("/tokens/access_token")
        .and_then(|v| v.as_str())
        .ok_or("No access_token in codex auth")?;
    let account_id = parsed
        .pointer("/tokens/account_id")
        .and_then(|v| v.as_str())
        .ok_or("No account_id in codex auth")?;

    let client = reqwest::Client::new();
    let resp = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("ChatGPT-Account-Id", account_id)
        .send()
        .await
        .map_err(|e| format!("Codex usage request failed: {e}"))?;

    let status_code = resp.status().as_u16();
    if status_code == 401 || status_code == 403 {
        return Err("Codex token expired. Re-authenticate with `codex auth`.".to_string());
    }
    if !resp.status().is_success() {
        return Err(format!("Codex usage endpoint returned {}", status_code));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Codex usage response: {e}"))?;

    // Parse the response — shape varies, try common structures
    // Expected: { "rate_limit": { "primary_window": { "used_percent": N }, "secondary_window": { "used_percent": N } } }
    // OR: { "used_percent": N }
    let primary_pct = body
        .pointer("/rate_limit/primary_window/used_percent")
        .and_then(|v| v.as_f64())
        .or_else(|| body.get("used_percent").and_then(|v| v.as_f64()));
    let secondary_pct = body
        .pointer("/rate_limit/secondary_window/used_percent")
        .and_then(|v| v.as_f64());

    let primary_reset = body
        .pointer("/rate_limit/primary_window/reset_at")
        .and_then(|v| v.as_i64());
    let secondary_reset = body
        .pointer("/rate_limit/secondary_window/reset_at")
        .and_then(|v| v.as_i64());

    let now_epoch = chrono::Utc::now().timestamp();

    // Map to the same shape the frontend expects
    Ok(json!({
        "supported": true,
        "status": if primary_pct.map_or(false, |p| p >= 100.0) { "rate_limited" } else { "allowed" },
        "five_h": {
            "utilization": primary_pct.map(|p| p / 100.0),
            "utilization_pct": primary_pct,
            "reset_at": primary_reset,
            "resets_in_secs": primary_reset.map(|r| (r - now_epoch).max(0)),
            "status": if primary_pct.map_or(false, |p| p >= 100.0) { "rate_limited" } else { "allowed" },
        },
        "seven_d": {
            "utilization": secondary_pct.map(|p| p / 100.0),
            "utilization_pct": secondary_pct,
            "reset_at": secondary_reset,
            "resets_in_secs": secondary_reset.map(|r| (r - now_epoch).max(0)),
            "status": Option::<String>::None,
        },
        "checked_at": chrono::Utc::now().to_rfc3339(),
        "_raw": body, // include raw response for debugging
    }))
}

/// Simple base64 decoder (standard alphabet).
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let bytes: Vec<u8> = input.bytes().filter(|&b| b != b'\n' && b != b'\r').collect();

    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        let mut count = 0;
        for (i, &b) in chunk.iter().enumerate() {
            if b == b'=' {
                break;
            }
            buf[i] = TABLE.iter().position(|&c| c == b)? as u8;
            count = i + 1;
        }
        if count >= 2 {
            out.push((buf[0] << 2) | (buf[1] >> 4));
        }
        if count >= 3 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if count >= 4 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    Some(out)
}
