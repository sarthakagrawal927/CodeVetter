import { useEffect, useState, useRef } from "react";
import { getSystemStats, isTauriAvailable } from "../lib/tauri-ipc";
import type { SystemStats, ProcessInfo } from "../lib/tauri-ipc";

const POLL_INTERVAL_MS = 5000;

function processDotColor(count: number): string {
  if (count <= 2) return "bg-emerald-400";
  if (count <= 5) return "bg-amber-400";
  return "bg-red-400";
}

function memoryBarPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function memoryBarColor(pct: number): string {
  if (pct < 70) return "bg-emerald-500/50";
  if (pct < 85) return "bg-amber-500/50";
  return "bg-red-500/50";
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export default function StatusBar() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isTauriAvailable()) return;

    let cancelled = false;

    async function poll() {
      try {
        const data = await getSystemStats();
        if (!cancelled) setStats(data);
      } catch {
        // Silently ignore — Tauri not ready or command failed
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!stats) {
    return (
      <div className="border-t border-[#1e2231] px-3 py-2">
        <div className="text-[10px] text-slate-600">Loading system stats...</div>
      </div>
    );
  }

  const memPct = memoryBarPercent(stats.system_memory_used_gb, stats.system_memory_total_gb);

  return (
    <div
      className="relative border-t border-[#1e2231] px-3 py-2 select-none"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Row 1: Process count */}
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${processDotColor(stats.claude_process_count)}`}
        />
        <span className="text-[10px] text-slate-400">
          {stats.claude_process_count} process{stats.claude_process_count !== 1 ? "es" : ""}
        </span>
      </div>

      {/* Row 2: Claude memory + CPU */}
      <div className="mt-1 flex items-center gap-2.5">
        <span className="text-[10px] text-slate-600">
          <span className="text-slate-500">{"\u25AA"}</span>{" "}
          <span className="text-slate-400">{formatMB(stats.claude_memory_mb)}</span>
        </span>
        <span className="text-[10px] text-slate-600">
          <span className="text-slate-500">{"\u25AA"}</span>{" "}
          <span className="text-slate-400">{stats.claude_cpu_percent.toFixed(0)}% CPU</span>
        </span>
      </div>

      {/* Row 3: System RAM usage */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[10px] text-slate-600">
          <span className="text-slate-500">{"\u25AA"}</span>{" "}
          <span className="text-slate-400">
            {stats.system_memory_used_gb.toFixed(1)}/{stats.system_memory_total_gb.toFixed(0)} GB
          </span>
        </span>
      </div>

      {/* Memory bar */}
      <div className="mt-1.5 h-1 w-full rounded-full bg-[#1e2231]">
        <div
          className={`h-1 rounded-full transition-all duration-500 ${memoryBarColor(memPct)}`}
          style={{ width: `${memPct}%` }}
        />
      </div>

      {/* Hover tooltip: per-process breakdown */}
      {showTooltip && stats.processes.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-[260px] rounded-md border border-[#1e2231] bg-[#0f1117] px-3 py-2 shadow-xl">
          <div className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-slate-600">
            Claude Processes
          </div>
          {stats.processes.map((proc: ProcessInfo) => (
            <div
              key={proc.pid}
              className="flex items-center justify-between py-0.5 text-[10px]"
            >
              <span className="max-w-[120px] truncate text-slate-400" title={proc.command}>
                {proc.command}
              </span>
              <span className="text-slate-600">PID {proc.pid}</span>
              <span className="text-slate-500">{formatMB(proc.memory_mb)}</span>
              <span className="text-slate-500">{proc.cpu_percent.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
