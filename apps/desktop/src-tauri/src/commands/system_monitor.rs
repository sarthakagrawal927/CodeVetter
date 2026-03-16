use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub claude_process_count: u32,
    pub claude_memory_mb: f64,
    pub claude_cpu_percent: f64,
    pub system_memory_total_gb: f64,
    pub system_memory_used_gb: f64,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Debug, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub command: String,
}

/// Get system stats for Claude-related processes.
///
/// Shells out to `ps` to find Claude processes and `sysctl`/`vm_stat`
/// for overall system memory info (macOS).
#[tauri::command]
pub async fn get_system_stats() -> Result<Value, String> {
    // 1. Get Claude process info via ps
    let ps_output = std::process::Command::new("ps")
        .args(["-eo", "pid,pcpu,rss,command"])
        .output()
        .map_err(|e| format!("Failed to run ps: {e}"))?;

    let stdout = String::from_utf8_lossy(&ps_output.stdout);
    let mut processes = Vec::new();
    let mut total_memory_kb: f64 = 0.0;
    let mut total_cpu: f64 = 0.0;

    for line in stdout.lines().skip(1) {
        let lower = line.to_lowercase();

        // Match claude processes, skip noise
        let is_claude = (lower.contains("/claude") || lower.contains("claude-code"))
            && !lower.contains("grep")
            && !lower.contains("code-reviewer")
            && !lower.contains("claude.ai")
            && !lower.contains("system_monitor"); // skip ourselves

        if !is_claude {
            continue;
        }

        // Parse: PID %CPU RSS COMMAND
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }

        let pid = fields[0].parse::<u32>().unwrap_or(0);
        let cpu = fields[1].parse::<f64>().unwrap_or(0.0);
        let rss_kb = fields[2].parse::<f64>().unwrap_or(0.0);
        let command = fields[3..].join(" ");

        // Truncate command for display — show last meaningful segment
        let short_command = command
            .split('/')
            .last()
            .unwrap_or(&command)
            .to_string();

        total_memory_kb += rss_kb;
        total_cpu += cpu;

        processes.push(ProcessInfo {
            pid,
            cpu_percent: cpu,
            memory_mb: rss_kb / 1024.0,
            command: short_command,
        });
    }

    // 2. Get total system memory via sysctl (macOS)
    let system_memory_total_gb = get_total_memory_gb().unwrap_or(0.0);

    // 3. Get used system memory via vm_stat (macOS)
    let system_memory_used_gb = get_used_memory_gb().unwrap_or(0.0);

    let stats = SystemStats {
        claude_process_count: processes.len() as u32,
        claude_memory_mb: total_memory_kb / 1024.0,
        claude_cpu_percent: total_cpu,
        system_memory_total_gb,
        system_memory_used_gb,
        processes,
    };

    Ok(json!(stats))
}

/// Get total physical memory in GB via `sysctl hw.memsize` (macOS).
fn get_total_memory_gb() -> Option<f64> {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let bytes: f64 = stdout.trim().parse().ok()?;
    Some(bytes / (1024.0 * 1024.0 * 1024.0))
}

/// Estimate used memory in GB via `vm_stat` (macOS).
///
/// Parses page counts from vm_stat output and multiplies by page size.
fn get_used_memory_gb() -> Option<f64> {
    let output = std::process::Command::new("vm_stat")
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // First line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
    let page_size: f64 = stdout
        .lines()
        .next()?
        .split("page size of ")
        .nth(1)?
        .split(' ')
        .next()?
        .parse()
        .ok()?;

    let mut active: f64 = 0.0;
    let mut wired: f64 = 0.0;
    let mut compressed: f64 = 0.0;
    let mut speculative: f64 = 0.0;

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let key = parts[0].trim();
        let val_str = parts[1].trim().trim_end_matches('.');
        let val: f64 = val_str.parse().unwrap_or(0.0);

        match key {
            "Pages active" => active = val,
            "Pages wired down" => wired = val,
            "Pages occupied by compressor" => compressed = val,
            "Pages speculative" => speculative = val,
            _ => {}
        }
    }

    let used_pages = active + wired + compressed + speculative;
    let used_bytes = used_pages * page_size;
    Some(used_bytes / (1024.0 * 1024.0 * 1024.0))
}
