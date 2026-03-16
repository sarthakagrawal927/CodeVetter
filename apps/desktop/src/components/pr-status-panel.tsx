import { useState, useEffect, useCallback } from "react";
import {
  getPullRequest,
  listCiChecks,
  mergePullRequest,
  rerunFailedChecks,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { PullRequestInfo, CICheck, WorkspaceRow } from "@/lib/tauri-ipc";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return "";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

type MergeMethod = "squash" | "merge" | "rebase";

// ─── Status / Review Decision Badges ────────────────────────────────────────

function PrStateBadge({ state }: { state: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    OPEN: { label: "Open", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    MERGED: { label: "Merged", color: "text-violet-400", bg: "bg-violet-500/10" },
    CLOSED: { label: "Closed", color: "text-red-400", bg: "bg-red-500/10" },
  };
  const c = config[state.toUpperCase()] ?? config.OPEN;
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase ${c.color} ${c.bg}`}>
      {c.label}
    </span>
  );
}

function ReviewDecisionBadge({ decision }: { decision: string }) {
  if (!decision) return null;
  const config: Record<string, { label: string; color: string; bg: string }> = {
    APPROVED: { label: "Approved", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    CHANGES_REQUESTED: { label: "Changes Requested", color: "text-red-400", bg: "bg-red-500/10" },
    REVIEW_REQUIRED: { label: "Review Required", color: "text-amber-400", bg: "bg-amber-500/10" },
  };
  const c = config[decision.toUpperCase()] ?? {
    label: decision,
    color: "text-slate-400",
    bg: "bg-slate-500/10",
  };
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${c.color} ${c.bg}`}>
      {c.label}
    </span>
  );
}

// ─── Check Status Icon ──────────────────────────────────────────────────────

function CheckIcon({ conclusion, state }: { conclusion: string | null; state: string }) {
  // Completed checks use conclusion; in-progress checks use state
  const effective = conclusion ?? state;
  switch (effective?.toUpperCase()) {
    case "SUCCESS":
      return <span className="text-emerald-400 text-[12px]" title="Success">&#10003;</span>;
    case "FAILURE":
    case "TIMED_OUT":
    case "CANCELLED":
      return <span className="text-red-400 text-[12px]" title={effective}>&#10007;</span>;
    case "PENDING":
    case "IN_PROGRESS":
    case "QUEUED":
      return <span className="text-amber-400 text-[12px]" title={effective}>&#9675;</span>;
    case "NEUTRAL":
    case "SKIPPED":
      return <span className="text-slate-500 text-[12px]" title={effective}>&#8212;</span>;
    default:
      return <span className="text-slate-600 text-[12px]" title={effective ?? "unknown"}>&#8226;</span>;
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface PrStatusPanelProps {
  workspace: WorkspaceRow;
  onPrUpdate?: () => void;
}

export default function PrStatusPanel({ workspace, onPrUpdate }: PrStatusPanelProps) {
  const [prInfo, setPrInfo] = useState<PullRequestInfo | null>(null);
  const [checks, setChecks] = useState<CICheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("squash");
  const [merging, setMerging] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [showMergeDropdown, setShowMergeDropdown] = useState(false);

  const prNumber = workspace.pr_number;

  const loadPrData = useCallback(async () => {
    if (!prNumber || !isTauriAvailable()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [pr, checksResult] = await Promise.all([
        getPullRequest(workspace.repo_path, prNumber),
        listCiChecks(workspace.repo_path, prNumber),
      ]);
      setPrInfo(pr);
      setChecks(checksResult.checks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspace.repo_path, prNumber]);

  useEffect(() => {
    loadPrData();
  }, [loadPrData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!prNumber) return;
    const interval = setInterval(loadPrData, 30000);
    return () => clearInterval(interval);
  }, [loadPrData, prNumber]);

  async function handleMerge() {
    if (!prNumber) return;
    setMerging(true);
    try {
      await mergePullRequest(workspace.repo_path, prNumber, mergeMethod);
      await loadPrData();
      onPrUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMerging(false);
      setShowMergeDropdown(false);
    }
  }

  async function handleRerunFailed() {
    if (!prNumber) return;
    setRerunning(true);
    try {
      await rerunFailedChecks(workspace.repo_path, prNumber);
      // Wait a moment then refresh
      setTimeout(loadPrData, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunning(false);
    }
  }

  function openInBrowser(url: string) {
    window.open(url, "_blank");
  }

  // No PR linked
  if (!prNumber) {
    return (
      <div className="p-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
          Pull Request
        </div>
        <div className="rounded-md bg-slate-500/5 border border-[#1e2231] px-3 py-2">
          <span className="text-[11px] text-slate-500">
            No PR linked to this workspace
          </span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
          Pull Request
        </div>
        <div className="flex items-center gap-2 py-3">
          <div className="h-3 w-3 animate-spin rounded-full border border-amber-500 border-t-transparent" />
          <span className="text-[11px] text-slate-500">Loading PR #{prNumber}...</span>
        </div>
      </div>
    );
  }

  if (error && !prInfo) {
    return (
      <div className="p-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
          Pull Request
        </div>
        <div className="rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2">
          <p className="text-[11px] text-red-400">{error}</p>
          <button
            onClick={loadPrData}
            className="mt-1 text-[10px] text-red-500 hover:text-red-300"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasFailedChecks = checks.some(
    (c) =>
      c.conclusion?.toUpperCase() === "FAILURE" ||
      c.conclusion?.toUpperCase() === "TIMED_OUT"
  );

  const allChecksPassed =
    checks.length > 0 &&
    checks.every(
      (c) =>
        c.conclusion?.toUpperCase() === "SUCCESS" ||
        c.conclusion?.toUpperCase() === "NEUTRAL" ||
        c.conclusion?.toUpperCase() === "SKIPPED"
    );

  const prState = prInfo?.state?.toUpperCase() ?? "OPEN";
  const isOpen = prState === "OPEN";

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── PR Header ─────────────────────────────────────────────────── */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
          Pull Request
        </div>

        {/* Title + number */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <button
              onClick={() => prInfo?.url && openInBrowser(prInfo.url)}
              className="text-[12px] font-medium text-slate-200 hover:text-amber-400 transition-colors text-left leading-tight"
              title="Open in GitHub"
            >
              {prInfo?.title ?? `PR #${prNumber}`}
            </button>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-slate-500 font-mono">
                #{prNumber}
              </span>
              <PrStateBadge state={prState} />
              {prInfo?.reviewDecision && (
                <ReviewDecisionBadge decision={prInfo.reviewDecision} />
              )}
            </div>
          </div>
        </div>

        {/* Author */}
        {prInfo?.author?.login && (
          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500">
            <span>by</span>
            <span className="text-slate-400 font-medium">{prInfo.author.login}</span>
          </div>
        )}

        {/* Branch labels */}
        <div className="flex items-center gap-1.5 mt-2 text-[10px]">
          <span className="rounded bg-[#1a1d27] px-1.5 py-0.5 text-[9px] text-slate-400 font-mono">
            {prInfo?.baseRefName ?? "main"}
          </span>
          <svg className="h-2.5 w-2.5 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
              clipRule="evenodd"
            />
          </svg>
          <span className="rounded bg-[#1a1d27] px-1.5 py-0.5 text-[9px] text-amber-400/70 font-mono">
            {prInfo?.headRefName ?? workspace.branch}
          </span>
        </div>
      </div>

      {/* ── Merge Section ─────────────────────────────────────────────── */}
      {isOpen && (
        <div className="border-t border-[#1e2231] pt-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <button
                onClick={handleMerge}
                disabled={merging}
                className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {merging ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <span className="h-2.5 w-2.5 animate-spin rounded-full border border-black/30 border-t-black" />
                    Merging...
                  </span>
                ) : (
                  `${mergeMethod.charAt(0).toUpperCase() + mergeMethod.slice(1)} merge`
                )}
              </button>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowMergeDropdown(!showMergeDropdown)}
                className="rounded-lg border border-[#1e2231] bg-[#1a1d27] px-2 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {showMergeDropdown && (
                <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border border-[#1e2231] bg-[#13151c] py-1 shadow-xl min-w-[120px]">
                  {(["squash", "merge", "rebase"] as MergeMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMergeMethod(m);
                        setShowMergeDropdown(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
                        mergeMethod === m
                          ? "text-amber-400 bg-amber-500/5"
                          : "text-slate-400 hover:text-slate-200 hover:bg-[#1a1d27]"
                      }`}
                    >
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mergeable status */}
          {prInfo?.mergeable && prInfo.mergeable !== "UNKNOWN" && (
            <div className="mt-1.5">
              <span
                className={`text-[9px] font-medium ${
                  prInfo.mergeable === "MERGEABLE"
                    ? "text-emerald-400"
                    : prInfo.mergeable === "CONFLICTING"
                      ? "text-red-400"
                      : "text-slate-500"
                }`}
              >
                {prInfo.mergeable === "MERGEABLE"
                  ? "No conflicts"
                  : prInfo.mergeable === "CONFLICTING"
                    ? "Has merge conflicts"
                    : prInfo.mergeable}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── CI Checks Section ─────────────────────────────────────────── */}
      <div className="border-t border-[#1e2231] pt-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              CI Checks
            </span>
            {checks.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0 text-[9px] font-semibold ${
                  allChecksPassed
                    ? "bg-emerald-500/10 text-emerald-400"
                    : hasFailedChecks
                      ? "bg-red-500/10 text-red-400"
                      : "bg-amber-500/10 text-amber-400"
                }`}
              >
                {allChecksPassed
                  ? "all passed"
                  : hasFailedChecks
                    ? "failing"
                    : "pending"}
              </span>
            )}
          </div>
          <button
            onClick={loadPrData}
            className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors"
            title="Refresh"
          >
            Refresh
          </button>
        </div>

        {checks.length === 0 ? (
          <div className="rounded-md bg-slate-500/5 border border-[#1e2231] px-3 py-2">
            <span className="text-[11px] text-slate-500">No CI checks found</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {checks.map((check, i) => (
              <div
                key={`${check.name}-${i}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1a1d27] transition-colors group"
              >
                <CheckIcon conclusion={check.conclusion} state={check.state} />
                <button
                  onClick={() => check.detailsUrl && openInBrowser(check.detailsUrl)}
                  className="flex-1 min-w-0 text-[11px] text-slate-300 truncate text-left hover:text-amber-400 transition-colors"
                  title={check.detailsUrl ? "Open in browser" : check.name}
                >
                  {check.name}
                </button>
                {check.conclusion && (
                  <span className="text-[9px] text-slate-600 shrink-0">
                    {check.conclusion.toLowerCase()}
                  </span>
                )}
                {check.startedAt && check.completedAt && (
                  <span className="text-[9px] text-slate-600 shrink-0 hidden group-hover:inline">
                    {formatDuration(check.startedAt, check.completedAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Re-run failed button */}
        {hasFailedChecks && (
          <button
            onClick={handleRerunFailed}
            disabled={rerunning}
            className="mt-2 w-full rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {rerunning ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-red-400/30 border-t-red-400" />
                Re-running...
              </span>
            ) : (
              "Re-run failed checks"
            )}
          </button>
        )}
      </div>

      {/* ── Error display ─────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-[10px] text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-1 text-[9px] text-red-500 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
