import { useState, useEffect, useCallback, useRef } from "react";
import {
  listSessions,
  getIndexStats,
  isTauriAvailable,
  onSessionUpdated,
} from "@/lib/tauri-ipc";
import type { SessionRow, IndexStats } from "@/lib/tauri-ipc";

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count === 0) return "0";
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function formatDuration(
  first: string | null,
  last: string | null
): string {
  if (!first || !last) return "--";
  const start = new Date(first).getTime();
  const end = new Date(last).getTime();
  if (isNaN(start) || isNaN(end)) return "--";
  const diffMs = Math.max(0, end - start);
  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 1) return "<1m";
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "--";
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const hour = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${month} ${day}, ${hour}:${min}`;
}

function projectDisplayName(cwd: string | null, projectId: string): string {
  if (cwd) {
    const segments = cwd.split("/").filter(Boolean);
    return segments.slice(-2).join("/");
  }
  return projectId.slice(0, 12);
}

// ─── Breakdown types ──────────────────────────────────────────────────────────

interface ProjectBreakdown {
  projectId: string;
  displayName: string;
  totalCost: number;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface ModelBreakdown {
  model: string;
  totalCost: number;
  sessionCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Usage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  // ─── Load data ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [sessionsResult, statsResult] = await Promise.allSettled([
        listSessions(undefined, undefined, 500, 0),
        getIndexStats(),
      ]);
      if (sessionsResult.status === "fulfilled") {
        setSessions(sessionsResult.value);
      }
      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      }
      const allFailed =
        sessionsResult.status === "rejected" &&
        statsResult.status === "rejected";
      if (allFailed) {
        const msg =
          sessionsResult.reason instanceof Error
            ? sessionsResult.reason.message
            : String(sessionsResult.reason);
        if (msg === "TAURI_NOT_AVAILABLE") {
          setError(
            "Tauri APIs not available. Run inside the desktop app."
          );
        } else {
          setError(msg);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let unlisten: (() => void) | undefined;
    onSessionUpdated(() => {
      loadData();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [loadData]);

  // ─── Computed aggregates ──────────────────────────────────────────────────

  const totalCost = sessions.reduce(
    (sum, s) => sum + (s.estimated_cost_usd ?? 0),
    0
  );
  const totalInputTokens = sessions.reduce(
    (sum, s) => sum + (s.total_input_tokens ?? 0),
    0
  );
  const totalOutputTokens = sessions.reduce(
    (sum, s) => sum + (s.total_output_tokens ?? 0),
    0
  );
  const totalTokens = totalInputTokens + totalOutputTokens;
  const totalCacheRead = sessions.reduce(
    (sum, s) => sum + (s.cache_read_tokens ?? 0),
    0
  );
  const totalCompactions = sessions.reduce(
    (sum, s) => sum + (s.compaction_count ?? 0),
    0
  );
  const sessionCount = sessions.length;
  const avgCostPerSession = sessionCount > 0 ? totalCost / sessionCount : 0;
  const cacheHitRate =
    totalInputTokens > 0 ? (totalCacheRead / totalInputTokens) * 100 : 0;

  // ─── Project breakdown ────────────────────────────────────────────────────

  const projectMap = new Map<string, ProjectBreakdown>();
  for (const s of sessions) {
    const existing = projectMap.get(s.project_id);
    if (existing) {
      existing.totalCost += s.estimated_cost_usd ?? 0;
      existing.sessionCount += 1;
      existing.totalInputTokens += s.total_input_tokens ?? 0;
      existing.totalOutputTokens += s.total_output_tokens ?? 0;
    } else {
      projectMap.set(s.project_id, {
        projectId: s.project_id,
        displayName: projectDisplayName(s.cwd, s.project_id),
        totalCost: s.estimated_cost_usd ?? 0,
        sessionCount: 1,
        totalInputTokens: s.total_input_tokens ?? 0,
        totalOutputTokens: s.total_output_tokens ?? 0,
      });
    }
  }
  const projectBreakdown = Array.from(projectMap.values()).sort(
    (a, b) => b.totalCost - a.totalCost
  );

  // ─── Model breakdown ──────────────────────────────────────────────────────

  const modelMap = new Map<string, ModelBreakdown>();
  for (const s of sessions) {
    const model = s.model_used ?? "unknown";
    const existing = modelMap.get(model);
    if (existing) {
      existing.totalCost += s.estimated_cost_usd ?? 0;
      existing.sessionCount += 1;
      existing.totalInputTokens += s.total_input_tokens ?? 0;
      existing.totalOutputTokens += s.total_output_tokens ?? 0;
    } else {
      modelMap.set(model, {
        model,
        totalCost: s.estimated_cost_usd ?? 0,
        sessionCount: 1,
        totalInputTokens: s.total_input_tokens ?? 0,
        totalOutputTokens: s.total_output_tokens ?? 0,
      });
    }
  }
  const modelBreakdown = Array.from(modelMap.values()).sort(
    (a, b) => b.totalCost - a.totalCost
  );

  // ─── Recent sessions (top 20 by last_message desc) ────────────────────────

  const recentSessions = [...sessions]
    .sort((a, b) => {
      const aTime = a.last_message ? new Date(a.last_message).getTime() : 0;
      const bTime = b.last_message ? new Date(b.last_message).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 20);

  // ─── Loading spinner ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f1117]">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="h-5 w-5 animate-spin text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-xs text-slate-500">Loading usage data...</p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 bg-[#0f1117] min-h-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">Usage & Stats</h1>
        <p className="mt-1 text-sm text-slate-500">
          Analytics across all indexed AI coding sessions.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <span className="text-red-400 text-sm">{"\u26A0"}</span>
          <p className="text-xs text-red-300">{error}</p>
          <button
            onClick={loadData}
            className="ml-auto text-xs text-red-400/50 hover:text-red-400"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Summary Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-6 gap-3">
        <SummaryCard
          label="Total Spend"
          value={formatCost(totalCost)}
          color="text-rose-400"
        />
        <SummaryCard
          label="Total Tokens"
          value={formatTokens(totalTokens)}
          color="text-cyan-400"
        />
        <SummaryCard
          label="Total Sessions"
          value={String(stats?.session_count ?? sessionCount)}
          color="text-amber-400"
        />
        <SummaryCard
          label="Avg Cost/Session"
          value={formatCost(avgCostPerSession)}
          color="text-amber-400"
        />
        <SummaryCard
          label="Cache Hit Rate"
          value={`${cacheHitRate.toFixed(1)}%`}
          color="text-emerald-400"
        />
        <SummaryCard
          label="Compactions"
          value={String(totalCompactions)}
          color="text-violet-400"
        />
      </div>

      {/* ── Breakdown Tables ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Cost by Project */}
        <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Cost by Project
          </h2>
          {projectBreakdown.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-600">
              No project data
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e2231] text-left text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Project</th>
                    <th className="pb-2 pr-3 font-medium text-right">Cost</th>
                    <th className="pb-2 pr-3 font-medium text-right">Sessions</th>
                    <th className="pb-2 font-medium text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {projectBreakdown.map((p) => (
                    <tr
                      key={p.projectId}
                      className="border-b border-[#1e2231]/50 last:border-0"
                    >
                      <td className="py-2 pr-3 text-slate-300 truncate max-w-[200px]">
                        {p.displayName}
                      </td>
                      <td className="py-2 pr-3 text-right text-rose-400 font-mono">
                        {formatCost(p.totalCost)}
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-400">
                        {p.sessionCount}
                      </td>
                      <td className="py-2 text-right text-cyan-400 font-mono">
                        {formatTokens(p.totalInputTokens + p.totalOutputTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Cost by Model */}
        <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Cost by Model
          </h2>
          {modelBreakdown.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-600">
              No model data
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1e2231] text-left text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Model</th>
                    <th className="pb-2 pr-3 font-medium text-right">Cost</th>
                    <th className="pb-2 pr-3 font-medium text-right">Sessions</th>
                    <th className="pb-2 font-medium text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {modelBreakdown.map((m) => (
                    <tr
                      key={m.model}
                      className="border-b border-[#1e2231]/50 last:border-0"
                    >
                      <td className="py-2 pr-3 text-slate-300 font-mono truncate max-w-[200px]">
                        {m.model}
                      </td>
                      <td className="py-2 pr-3 text-right text-rose-400 font-mono">
                        {formatCost(m.totalCost)}
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-400">
                        {m.sessionCount}
                      </td>
                      <td className="py-2 text-right text-cyan-400 font-mono">
                        {formatTokens(m.totalInputTokens + m.totalOutputTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Sessions ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">
          Recent Sessions
        </h2>
        {recentSessions.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-600">
            No sessions indexed yet
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1e2231] text-left text-slate-500">
                  <th className="pb-2 pr-3 font-medium">Session</th>
                  <th className="pb-2 pr-3 font-medium">Agent</th>
                  <th className="pb-2 pr-3 font-medium">Model</th>
                  <th className="pb-2 pr-3 font-medium text-right">Input</th>
                  <th className="pb-2 pr-3 font-medium text-right">Output</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cache Read</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cache Create</th>
                  <th className="pb-2 pr-3 font-medium text-right">Cost</th>
                  <th className="pb-2 pr-3 font-medium text-right">Compactions</th>
                  <th className="pb-2 pr-3 font-medium text-right">Duration</th>
                  <th className="pb-2 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentSessions.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-[#1e2231]/50 last:border-0"
                  >
                    <td className="py-2 pr-3 text-slate-300 truncate max-w-[160px]">
                      {s.slug || s.id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-3">
                      <AgentBadge agentType={s.agent_type} />
                    </td>
                    <td className="py-2 pr-3 text-slate-400 font-mono truncate max-w-[120px]">
                      {s.model_used ?? "--"}
                    </td>
                    <td className="py-2 pr-3 text-right text-cyan-400 font-mono">
                      {formatTokens(s.total_input_tokens)}
                    </td>
                    <td className="py-2 pr-3 text-right text-cyan-400 font-mono">
                      {formatTokens(s.total_output_tokens)}
                    </td>
                    <td className="py-2 pr-3 text-right text-emerald-400/70 font-mono">
                      {formatTokens(s.cache_read_tokens)}
                    </td>
                    <td className="py-2 pr-3 text-right text-amber-400/70 font-mono">
                      {formatTokens(s.cache_creation_tokens)}
                    </td>
                    <td className="py-2 pr-3 text-right text-rose-400 font-mono">
                      {formatCost(s.estimated_cost_usd)}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-400">
                      {s.compaction_count}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-400">
                      {formatDuration(s.first_message, s.last_message)}
                    </td>
                    <td className="py-2 text-right text-slate-500 whitespace-nowrap">
                      {formatDate(s.last_message ?? s.indexed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function AgentBadge({ agentType }: { agentType: string }) {
  const isClaude = agentType === "claude-code";
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        isClaude
          ? "bg-amber-500/10 text-amber-400"
          : "bg-emerald-500/10 text-emerald-400"
      }`}
    >
      {isClaude ? "Claude" : "Codex"}
    </span>
  );
}
