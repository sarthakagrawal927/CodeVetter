use crate::db::queries;
use crate::DbState;
use serde_json::{json, Value};
use tauri::State;

const REDIRECT_URI: &str = "http://localhost:9876/callback";

/// Resolve the Linear OAuth client ID.
/// Priority: env var > preferences table > error.
fn resolve_linear_client_id(conn: &rusqlite::Connection) -> Result<String, String> {
    // 1. Environment variable
    if let Ok(val) = std::env::var("CODEVETTER_LINEAR_CLIENT_ID") {
        let val = val.trim().to_string();
        if !val.is_empty() {
            return Ok(val);
        }
    }

    // 2. Preferences table
    if let Ok(Some(val)) = queries::get_preference(conn, "linear_client_id") {
        let val = val.trim().to_string();
        if !val.is_empty() {
            return Ok(val);
        }
    }

    Err("Linear OAuth not configured. Set CODEVETTER_LINEAR_CLIENT_ID environment variable or configure in Settings.".to_string())
}

// ─── PKCE helpers ────────────────────────────────────────────────────────────

fn generate_code_verifier() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let s = RandomState::new();
    let mut bytes = Vec::with_capacity(64);
    for _ in 0..8 {
        let mut h = s.build_hasher();
        h.write_usize(bytes.len());
        bytes.extend_from_slice(&h.finish().to_le_bytes());
    }

    // Base64-url-encode (no padding)
    base64_url_encode(&bytes)
}

fn sha256(input: &[u8]) -> Vec<u8> {
    // Minimal SHA-256 implementation (no extra crate needed).
    // We use a simple approach: shell out to openssl or use a hand-rolled version.
    // For correctness and simplicity, we'll use a pure-Rust SHA-256.
    sha256_digest(input)
}

fn base64_url_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut result = String::new();
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() { data[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if i + 1 < data.len() {
            result.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        }
        if i + 2 < data.len() {
            result.push(ALPHABET[(triple & 0x3F) as usize] as char);
        }
        i += 3;
    }
    result
}

/// Pure-Rust SHA-256 (no extra dependency).
fn sha256_digest(data: &[u8]) -> Vec<u8> {
    let h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let k: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    // Pre-processing: pad the message
    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut hash = h;

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[4 * i],
                chunk[4 * i + 1],
                chunk[4 * i + 2],
                chunk[4 * i + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) = (
            hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7],
        );

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(k[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        hash[0] = hash[0].wrapping_add(a);
        hash[1] = hash[1].wrapping_add(b);
        hash[2] = hash[2].wrapping_add(c);
        hash[3] = hash[3].wrapping_add(d);
        hash[4] = hash[4].wrapping_add(e);
        hash[5] = hash[5].wrapping_add(f);
        hash[6] = hash[6].wrapping_add(g);
        hash[7] = hash[7].wrapping_add(hh);
    }

    let mut result = Vec::with_capacity(32);
    for h in &hash {
        result.extend_from_slice(&h.to_be_bytes());
    }
    result
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Start the Linear OAuth flow: generate PKCE, open browser, listen for callback,
/// exchange code for token, store in preferences.
#[tauri::command]
pub async fn start_linear_oauth(db: State<'_, DbState>) -> Result<Value, String> {
    let client_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        resolve_linear_client_id(&conn)?
    };

    let code_verifier = generate_code_verifier();
    let challenge_bytes = sha256(code_verifier.as_bytes());
    let code_challenge = base64_url_encode(&challenge_bytes);

    let auth_url = format!(
        "https://linear.app/oauth/authorize?client_id={}&redirect_uri={}&response_type=code&scope=read&code_challenge={}&code_challenge_method=S256",
        client_id,
        urlencoding_encode(REDIRECT_URI),
        code_challenge,
    );

    // Open the browser
    if let Err(e) = std::process::Command::new("open").arg(&auth_url).spawn() {
        return Err(format!("Failed to open browser: {e}"));
    }

    // Start a temporary local TCP server to receive the OAuth callback.
    // This runs in a blocking thread with a timeout.
    let verifier = code_verifier.clone();
    let cid = client_id.clone();
    let code_result = tokio::task::spawn_blocking(move || {
        listen_for_oauth_callback(verifier, &cid)
    })
    .await
    .map_err(|e| format!("OAuth listener task failed: {e}"))?;

    let access_token = code_result?;

    // Store token in preferences
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    queries::set_preference(&conn, "linear_access_token", &access_token)
        .map_err(|e| e.to_string())?;

    Ok(json!({ "success": true }))
}

/// Listens on port 9876 for the OAuth callback, extracts the code,
/// and exchanges it for an access token.
fn listen_for_oauth_callback(code_verifier: String, client_id: &str) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    let listener =
        TcpListener::bind("127.0.0.1:9876").map_err(|e| format!("Failed to bind port 9876: {e}"))?;
    listener
        .set_nonblocking(false)
        .map_err(|e| format!("Failed to set blocking: {e}"))?;

    // Set a 2-minute timeout so we don't hang forever.
    let timeout = Duration::from_secs(120);
    listener
        .set_nonblocking(false)
        .ok();

    // Accept one connection with a timeout (poll approach).
    let start = std::time::Instant::now();
    let mut stream = loop {
        listener.set_nonblocking(true).ok();
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() > timeout {
                    return Err("OAuth callback timed out after 2 minutes".to_string());
                }
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(format!("Accept failed: {e}")),
        }
    };

    // Read the HTTP request to extract the authorization code
    let reader = BufReader::new(&stream);
    let request_line = reader
        .lines()
        .next()
        .ok_or("No request received")?
        .map_err(|e| format!("Failed to read request: {e}"))?;

    // Parse: GET /callback?code=XXXXX HTTP/1.1
    let code = extract_query_param(&request_line, "code")
        .ok_or_else(|| {
            // Check for error parameter
            let error = extract_query_param(&request_line, "error")
                .unwrap_or_else(|| "unknown".to_string());
            format!("OAuth failed: {error}")
        })?;

    // Send a nice HTML response to the browser
    let html_body = r#"<!DOCTYPE html><html><body style="font-family:system-ui;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connected to Linear!</h2><p style="color:#94a3b8">You can close this tab and return to CodeVetter.</p></div></body></html>"#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html_body.len(),
        html_body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    drop(stream);

    // Exchange the authorization code for an access token
    exchange_code_for_token(&code, &code_verifier, client_id)
}

/// Exchange an OAuth authorization code for an access token (synchronous).
fn exchange_code_for_token(code: &str, code_verifier: &str, client_id: &str) -> Result<String, String> {
    // Use a synchronous reqwest client since we're already in a blocking thread.
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post("https://api.linear.app/oauth/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("redirect_uri", REDIRECT_URI),
            ("code", code),
            ("code_verifier", code_verifier),
        ])
        .send()
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("Token exchange failed ({status}): {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    body.get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in response".to_string())
}

/// Extract a query parameter from an HTTP request line like
/// `GET /callback?code=abc&state=xyz HTTP/1.1`.
fn extract_query_param(request_line: &str, param: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if let (Some(key), Some(value)) = (kv.next(), kv.next()) {
            if key == param {
                return Some(urlencoding_decode(value));
            }
        }
    }
    None
}

/// Minimal percent-encoding for URLs (covers the characters Linear needs).
fn urlencoding_encode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

/// Minimal percent-decoding.
fn urlencoding_decode(input: &str) -> String {
    let mut result = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) =
                u8::from_str_radix(&input[i + 1..i + 3], 16)
            {
                result.push(val);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            result.push(b' ');
        } else {
            result.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&result).to_string()
}

/// Remove the stored Linear access token (disconnect).
#[tauri::command]
pub async fn disconnect_linear(db: State<'_, DbState>) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM preferences WHERE key = 'linear_access_token'", [])
        .map_err(|e| e.to_string())?;
    Ok(json!({ "disconnected": true }))
}

/// Check if Linear is connected by testing the stored token against the API.
#[tauri::command]
pub async fn check_linear_connection(db: State<'_, DbState>) -> Result<Value, String> {
    let token = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_preference(&conn, "linear_access_token").map_err(|e| e.to_string())?
    };

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(json!({ "connected": false })),
    };

    // Test the token with a simple viewer query
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.linear.app/graphql")
        .bearer_auth(&token)
        .json(&json!({
            "query": "{ viewer { id name email } }"
        }))
        .send()
        .await
        .map_err(|e| format!("Linear API request failed: {e}"))?;

    if !resp.status().is_success() {
        // Token may be expired — clean it up
        return Ok(json!({ "connected": false, "error": "Token expired or invalid" }));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

    if let Some(viewer) = body.get("data").and_then(|d| d.get("viewer")) {
        Ok(json!({
            "connected": true,
            "user": {
                "id": viewer.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "name": viewer.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "email": viewer.get("email").and_then(|v| v.as_str()).unwrap_or(""),
            }
        }))
    } else {
        Ok(json!({ "connected": false, "error": "Unexpected API response" }))
    }
}

/// Fetch issues assigned to the authenticated user from Linear.
#[tauri::command]
pub async fn list_linear_issues(db: State<'_, DbState>) -> Result<Value, String> {
    let token = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_preference(&conn, "linear_access_token").map_err(|e| e.to_string())?
    };

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not connected to Linear".to_string()),
    };

    let query = r#"
        query {
            viewer {
                assignedIssues(first: 50, filter: { state: { type: { in: ["backlog", "unstarted", "started"] } } }) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        priority
                        priorityLabel
                        state { name type }
                        team { name key }
                        url
                        createdAt
                    }
                }
            }
        }
    "#;

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.linear.app/graphql")
        .bearer_auth(&token)
        .json(&json!({ "query": query }))
        .send()
        .await
        .map_err(|e| format!("Linear API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Linear API error ({status}): {body}"));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

    let nodes = body
        .get("data")
        .and_then(|d| d.get("viewer"))
        .and_then(|v| v.get("assignedIssues"))
        .and_then(|ai| ai.get("nodes"))
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let issues: Vec<Value> = nodes
        .into_iter()
        .map(|node| {
            json!({
                "id": node.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "identifier": node.get("identifier").and_then(|v| v.as_str()).unwrap_or(""),
                "title": node.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                "description": node.get("description").and_then(|v| v.as_str()),
                "priority": node.get("priority").and_then(|v| v.as_i64()).unwrap_or(0),
                "priorityLabel": node.get("priorityLabel").and_then(|v| v.as_str()).unwrap_or("No priority"),
                "stateName": node.get("state").and_then(|s| s.get("name")).and_then(|v| v.as_str()).unwrap_or(""),
                "stateType": node.get("state").and_then(|s| s.get("type")).and_then(|v| v.as_str()).unwrap_or(""),
                "teamName": node.get("team").and_then(|t| t.get("name")).and_then(|v| v.as_str()).unwrap_or(""),
                "teamKey": node.get("team").and_then(|t| t.get("key")).and_then(|v| v.as_str()).unwrap_or(""),
                "url": node.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                "createdAt": node.get("createdAt").and_then(|v| v.as_str()).unwrap_or(""),
            })
        })
        .collect();

    Ok(json!({ "issues": issues }))
}

/// Import selected Linear issues as agent tasks.
#[tauri::command]
pub async fn import_linear_issues(
    db: State<'_, DbState>,
    issue_ids: Vec<String>,
) -> Result<Value, String> {
    if issue_ids.is_empty() {
        return Ok(json!({ "imported": 0 }));
    }

    let token = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        queries::get_preference(&conn, "linear_access_token").map_err(|e| e.to_string())?
    };

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Err("Not connected to Linear".to_string()),
    };

    // Build a query to fetch the selected issues by ID
    let ids_str = issue_ids
        .iter()
        .map(|id| format!("\"{}\"", id.replace('"', "")))
        .collect::<Vec<_>>()
        .join(", ");

    let query = format!(
        r#"query {{
            issues(filter: {{ id: {{ in: [{}] }} }}) {{
                nodes {{
                    id
                    identifier
                    title
                    description
                    priority
                    priorityLabel
                    state {{ name type }}
                    team {{ name key }}
                    url
                }}
            }}
        }}"#,
        ids_str
    );

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.linear.app/graphql")
        .bearer_auth(&token)
        .json(&json!({ "query": query }))
        .send()
        .await
        .map_err(|e| format!("Linear API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Linear API error ({status}): {body}"));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

    let nodes = body
        .get("data")
        .and_then(|d| d.get("issues"))
        .and_then(|i| i.get("nodes"))
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default();

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut imported = 0u32;

    for node in &nodes {
        let identifier = node
            .get("identifier")
            .and_then(|v| v.as_str())
            .unwrap_or("???");
        let title = node
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled");
        let description = node.get("description").and_then(|v| v.as_str());
        let url = node.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let team_key = node
            .get("team")
            .and_then(|t| t.get("key"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let task_title = format!("[{}] {}", identifier, title);
        let task_description = match description {
            Some(desc) if !desc.is_empty() => {
                format!("{}\n\n---\nLinear: {}", desc, url)
            }
            _ => format!("Imported from Linear: {}", url),
        };

        let metadata = json!({
            "linear_id": node.get("id").and_then(|v| v.as_str()).unwrap_or(""),
            "linear_identifier": identifier,
            "linear_url": url,
            "linear_team": team_key,
        });

        let input = queries::AgentTaskInput {
            title: task_title,
            description: Some(task_description),
            acceptance_criteria: Some(format!("Source: Linear {}", identifier)),
            project_path: None,
            status: Some("backlog".to_string()),
        };

        match queries::create_agent_task(&conn, &input) {
            Ok(_task_id) => {
                imported += 1;
                // Log activity
                let _ = queries::log_activity(
                    &conn,
                    &queries::ActivityInput {
                        agent_id: None,
                        event_type: Some("linear_import".to_string()),
                        summary: Some(format!("Imported Linear issue {}", identifier)),
                        metadata: Some(metadata.to_string()),
                    },
                );
            }
            Err(e) => {
                log::warn!("Failed to import Linear issue {}: {}", identifier, e);
            }
        }
    }

    Ok(json!({ "imported": imported }))
}
