import { useState, useEffect } from "react";
import {
  onReviewStateChanged,
  getReviewState,
} from "@/lib/tauri-ipc";
import type { ReviewStateCRDT, AgentStatusCRDT } from "@/lib/tauri-ipc";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case "reviewing":
    case "working":
      return "text-amber-400";
    case "done":
    case "complete":
    case "completed":
      return "text-emerald-400";
    case "error":
    case "failed":
      return "text-red-400";
    case "idle":
    case "waiting":
      return "text-slate-500";
    default:
      return "text-slate-400";
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case "reviewing":
    case "working":
      return "bg-amber-400";
    case "done":
    case "complete":
    case "completed":
      return "bg-emerald-400";
    case "error":
    case "failed":
      return "bg-red-400";
    default:
      return "bg-slate-500";
  }
}

function isAgentDone(status: string): boolean {
  return status === "done" || status === "complete" || status === "completed";
}

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "text-red-400";
    case "high":
      return "text-rose-400";
    case "medium":
    case "warning":
      return "text-amber-400";
    case "low":
      return "text-slate-400";
    case "suggestion":
      return "text-blue-400";
    default:
      return "text-slate-500";
  }
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({
  agentId,
  status,
}: {
  agentId: string;
  status: AgentStatusCRDT;
}) {
  const done = isAgentDone(status.status);
  const pct = Math.round(status.progress * 100);

  return (
    <div className="rounded-lg border border-[#1e2231] bg-[#13151c] p-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`h-2 w-2 rounded-full ${statusDotColor(status.status)} ${
            !done ? "animate-pulse" : ""
          }`}
        />
        <span className="text-[12px] font-medium text-slate-200 truncate">
          {agentId}
        </span>
        <span
          className={`ml-auto text-[10px] font-medium uppercase tracking-wider ${statusColor(
            status.status
          )}`}
        >
          {status.status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e2231]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            done ? "bg-emerald-500" : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Current file */}
      {status.current_file && !done && (
        <p className="mt-1.5 text-[10px] text-slate-500 font-mono truncate">
          {status.current_file}
        </p>
      )}
      {done && (
        <p className="mt-1.5 text-[10px] text-emerald-400/60">Complete</p>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ReviewLiveProps {
  reviewId: string;
  repoPath: string;
  onComplete?: () => void;
}

export default function ReviewLive({
  reviewId,
  repoPath,
  onComplete,
}: ReviewLiveProps) {
  const [state, setState] = useState<ReviewStateCRDT | null>(null);

  // Subscribe to live CRDT state changes
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    // Get initial state
    getReviewState(reviewId, repoPath)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((err) => console.error("Failed to get initial review state:", err));

    // Listen for updates
    onReviewStateChanged((s) => {
      if (s.review_id === reviewId) {
        setState(s);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [reviewId, repoPath]);

  // Check if all agents are done
  useEffect(() => {
    if (!state) return;
    const agents = Object.values(state.agent_status);
    if (agents.length > 0 && agents.every((a) => isAgentDone(a.status))) {
      onComplete?.();
    }
  }, [state, onComplete]);

  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <span className="text-[12px] text-slate-500">
          Connecting to review...
        </span>
      </div>
    );
  }

  const agents = Object.entries(state.agent_status);
  const allDone =
    agents.length > 0 && agents.every(([, a]) => isAgentDone(a.status));
  const findingCount = state.findings.length;
  const claimedCount = Object.keys(state.files_claimed).length;

  return (
    <div className="flex flex-col gap-4 fade-in">
      {/* Header stats */}
      <div className="flex items-baseline gap-4 text-[11px]">
        <span className="text-slate-500">
          Review{" "}
          <span className="font-mono text-slate-400">
            {reviewId.slice(0, 8)}
          </span>
        </span>
        <span className="text-slate-500">
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </span>
        <span className="text-slate-500">
          {claimedCount} file{claimedCount !== 1 ? "s" : ""} claimed
        </span>
        <span className="text-slate-500">
          {findingCount} finding{findingCount !== 1 ? "s" : ""}
        </span>
        {allDone && (
          <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
            All agents complete
          </span>
        )}
      </div>

      {/* Agent cards */}
      {agents.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Agents
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {agents.map(([id, status]) => (
              <AgentCard key={id} agentId={id} status={status} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[#1e2231] bg-[#13151c] p-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="text-[12px] text-slate-500">
              Waiting for agents to connect...
            </span>
          </div>
        </div>
      )}

      {/* Live findings feed */}
      {findingCount > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Findings ({findingCount})
          </h3>
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {state.findings
              .slice()
              .reverse()
              .map((f) => (
                <div
                  key={f.id}
                  className="rounded-md border border-[#1e2231] bg-[#0f1117] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase ${severityColor(
                        f.severity
                      )}`}
                    >
                      {f.severity}
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono truncate">
                      {f.file}
                      {f.line_start > 0 ? `:${f.line_start}` : ""}
                    </span>
                    <span className="ml-auto text-[9px] text-slate-600">
                      {f.agent_id.length > 10
                        ? f.agent_id.slice(0, 8) + "..."
                        : f.agent_id}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">
                    {f.message}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* File claims */}
      {claimedCount > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-400 transition-colors">
            File assignments ({claimedCount})
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {Object.entries(state.files_claimed).map(([file, agent]) => (
              <div
                key={file}
                className="flex items-center gap-2 text-[10px] text-slate-500"
              >
                <span className="font-mono truncate flex-1">{file}</span>
                <span className="text-slate-600 shrink-0">
                  {agent.length > 10 ? agent.slice(0, 8) + "..." : agent}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
