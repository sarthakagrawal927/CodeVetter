import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  isTauriAvailable,
  startLocalReview,
  startPrReview,
  getReview,
  getGitRemoteInfo,
} from "@/lib/tauri-ipc";
import type {
  WorkspaceRow,
  Review,
  ReviewFinding,
  ReviewTone,
} from "@/lib/tauri-ipc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type FindingAction = "pending" | "accepted" | "dismissed";

interface TriagedFinding {
  finding: ReviewFinding;
  action: FindingAction;
  comment: string;
}

// ─── Severity Config ────────────────────────────────────────────────────────

const SEVERITY_ORDER = ["critical", "high", "medium", "warning", "low", "suggestion", "info"];

const SEVERITY_CONFIG: Record<
  string,
  { dot: string; text: string; bg: string; border: string; label: string }
> = {
  critical: {
    dot: "bg-red-500",
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    label: "Critical",
  },
  high: {
    dot: "bg-rose-500",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    label: "High",
  },
  medium: {
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    label: "Medium",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    label: "Warning",
  },
  low: {
    dot: "bg-slate-500",
    text: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
    label: "Low",
  },
  suggestion: {
    dot: "bg-blue-500",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    label: "Suggestion",
  },
  info: {
    dot: "bg-slate-500",
    text: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
    label: "Info",
  },
};

function getSevConfig(severity: string | null) {
  return SEVERITY_CONFIG[(severity ?? "info").toLowerCase()] ?? SEVERITY_CONFIG.info;
}

function severityRank(severity: string | null): number {
  const idx = SEVERITY_ORDER.indexOf((severity ?? "info").toLowerCase());
  return idx === -1 ? 99 : idx;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function repoName(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() || repoPath;
}

// ─── Severity Summary Bar ───────────────────────────────────────────────────

function SeverityBar({ findings }: { findings: ReviewFinding[] }) {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const sev = (f.severity ?? "info").toLowerCase();
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  const total = findings.length;
  if (total === 0) return null;

  const segments = SEVERITY_ORDER.filter((s) => counts[s])
    .map((s) => ({ severity: s, count: counts[s], pct: (counts[s] / total) * 100 }));

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#1e2231]">
      {segments.map((seg) => (
        <div
          key={seg.severity}
          className={`${getSevConfig(seg.severity).dot} transition-all`}
          style={{ width: `${seg.pct}%` }}
          title={`${seg.count} ${seg.severity}`}
        />
      ))}
    </div>
  );
}

// ─── Confidence Bar ─────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-[#1e2231]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-slate-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 tabular-nums">{pct}%</span>
    </div>
  );
}

// ─── Code Suggestion Block ──────────────────────────────────────────────────

function SuggestionBlock({ suggestion }: { suggestion: string }) {
  const lines = suggestion.split("\n");
  return (
    <div className="mt-3 rounded-lg border border-[#1e2231] bg-[#0a0b0f] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-[#1e2231] text-[10px] font-medium text-slate-500 uppercase tracking-wider">
        Suggestion
      </div>
      <div className="p-3 font-mono text-[12px] leading-relaxed overflow-x-auto">
        {lines.map((line, i) => {
          const isAdd = line.startsWith("+");
          const isRemove = line.startsWith("-");
          return (
            <div
              key={i}
              className={cn(
                "px-1",
                isAdd && "bg-emerald-500/10 text-emerald-300",
                isRemove && "bg-red-500/10 text-red-300",
                !isAdd && !isRemove && "text-slate-400"
              )}
            >
              {line || "\u00A0"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Inline Comment Input ───────────────────────────────────────────────────

function InlineCommentInput({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Add a note about this finding..."
        autoFocus
        className="w-full bg-[#0a0b0f] border border-[#1e2231] rounded-lg p-2.5 text-[12px] text-slate-300 font-mono resize-none focus:outline-none focus:border-amber-500/40 placeholder:text-slate-600"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-auto px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

// ─── Finding Card ───────────────────────────────────────────────────────────

function FindingCard({
  triaged,
  isSelected,
  onSelect,
  onAction,
  onComment,
}: {
  triaged: TriagedFinding;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: FindingAction) => void;
  onComment: (comment: string) => void;
}) {
  const { finding, action, comment } = triaged;
  const config = getSevConfig(finding.severity);
  const [showComment, setShowComment] = useState(false);

  const location = finding.file_path
    ? finding.line
      ? `${finding.file_path}:${finding.line}`
      : finding.file_path
    : null;

  return (
    <Card
      className={cn(
        "border bg-[#13151c] transition-all cursor-pointer",
        isSelected
          ? "border-amber-500/40 ring-1 ring-amber-500/20"
          : "border-[#1e2231] hover:border-[#2a2e3d]",
        action === "dismissed" && "opacity-50"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        {/* Header: title + severity badge */}
        <div className="flex items-start gap-3">
          {/* Severity dot */}
          <div className={cn("mt-1.5 h-2.5 w-2.5 rounded-full shrink-0", config.dot)} />

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4
                className={cn(
                  "text-[14px] font-medium text-slate-200 leading-snug",
                  action === "dismissed" && "line-through text-slate-500"
                )}
              >
                {finding.title || finding.summary || "Untitled finding"}
              </h4>
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5",
                  config.text,
                  config.bg,
                  config.border
                )}
              >
                {finding.severity ?? "info"}
              </Badge>
            </div>

            {/* File + line location */}
            {location && (
              <p className="mt-1 text-[12px] font-mono text-slate-500">{location}</p>
            )}

            {/* Description */}
            {finding.summary && action !== "dismissed" && (
              <p className="mt-2.5 text-[13px] leading-relaxed text-slate-400">
                {finding.summary}
              </p>
            )}

            {/* Confidence */}
            {finding.confidence !== null && finding.confidence !== undefined && action !== "dismissed" && (
              <div className="mt-2">
                <ConfidenceBar value={finding.confidence} />
              </div>
            )}

            {/* Code suggestion */}
            {finding.suggestion && action !== "dismissed" && (
              <SuggestionBlock suggestion={finding.suggestion} />
            )}

            {/* Comment */}
            {showComment && (
              <InlineCommentInput
                value={comment}
                onChange={onComment}
                onClose={() => setShowComment(false)}
              />
            )}
            {!showComment && comment && (
              <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-[11px] text-amber-400/80 italic">{comment}</p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(action === "accepted" ? "pending" : "accepted");
                }}
                className={cn(
                  "h-auto px-2.5 py-1 text-[11px] font-medium rounded-md",
                  action === "accepted"
                    ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                    : "text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                )}
              >
                {action === "accepted" ? "\u2713 Accepted" : "\u2713 Accept"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(action === "dismissed" ? "pending" : "dismissed");
                }}
                className={cn(
                  "h-auto px-2.5 py-1 text-[11px] font-medium rounded-md",
                  action === "dismissed"
                    ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                    : "text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                )}
              >
                {action === "dismissed" ? "\u2717 Dismissed" : "\u2717 Dismiss"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowComment(!showComment);
                }}
                className="h-auto px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-md"
              >
                {comment ? "Edit Note" : "Add Note"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Progress / Loading State ───────────────────────────────────────────────

function ReviewProgress({
  review,
  startedAt,
}: {
  review: Review | null;
  startedAt: string | null;
}) {
  const status = review?.status ?? "analyzing";
  const isFailed = status === "failed";

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      {isFailed ? (
        <>
          <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-lg">{"\u2717"}</span>
          </div>
          <div className="text-center">
            <p className="text-[14px] font-medium text-red-400">Review Failed</p>
            <p className="text-[12px] text-slate-500 mt-1 max-w-md">
              {review?.error_message ?? "An unknown error occurred during the review."}
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="relative">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <div className="absolute inset-0 h-10 w-10 animate-ping rounded-full border border-amber-500/20" />
          </div>
          <div className="text-center">
            <p className="text-[14px] font-medium text-slate-200">Analyzing code...</p>
            <p className="text-[12px] text-slate-500 mt-1">
              {startedAt ? `Started ${formatRelativeTime(startedAt)}` : "Starting review..."}
            </p>
          </div>
          <div className="flex gap-6 text-[11px] text-slate-500 mt-2">
            <span>Scanning files</span>
            <span className="text-slate-600">{">"}</span>
            <span className={status === "analyzing" ? "text-amber-400" : ""}>
              Running analysis
            </span>
            <span className="text-slate-600">{">"}</span>
            <span>Generating findings</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Export Markdown ────────────────────────────────────────────────────────

function buildMarkdown(
  review: Review,
  triaged: TriagedFinding[],
  workspace: WorkspaceRow
): string {
  const lines: string[] = [];
  lines.push(`# Code Review: ${workspace.name}`);
  lines.push("");
  lines.push(`**Repository:** ${repoName(workspace.repo_path)}`);
  lines.push(`**Branch:** ${workspace.branch}`);
  if (review.score_composite !== null) {
    lines.push(`**Score:** ${review.score_composite.toFixed(1)}/10`);
  }
  lines.push(`**Findings:** ${triaged.length}`);
  lines.push("");

  if (review.summary_markdown) {
    lines.push("## Summary");
    lines.push("");
    lines.push(review.summary_markdown);
    lines.push("");
  }

  const accepted = triaged.filter((t) => t.action === "accepted");
  const dismissed = triaged.filter((t) => t.action === "dismissed");
  const pending = triaged.filter((t) => t.action === "pending");

  function renderFinding(t: TriagedFinding) {
    const f = t.finding;
    const sev = (f.severity ?? "info").toUpperCase();
    const loc = f.file_path ? (f.line ? `${f.file_path}:${f.line}` : f.file_path) : "";
    lines.push(`### [${sev}] ${f.title || f.summary || "Finding"}`);
    if (loc) lines.push(`\`${loc}\``);
    lines.push("");
    if (f.summary) lines.push(f.summary);
    if (f.suggestion) {
      lines.push("");
      lines.push("**Suggestion:**");
      lines.push("```");
      lines.push(f.suggestion);
      lines.push("```");
    }
    if (t.comment) {
      lines.push("");
      lines.push(`> **Note:** ${t.comment}`);
    }
    lines.push("");
  }

  if (accepted.length > 0) {
    lines.push("## Accepted Findings");
    lines.push("");
    accepted.forEach(renderFinding);
  }

  if (pending.length > 0) {
    lines.push("## Pending Findings");
    lines.push("");
    pending.forEach(renderFinding);
  }

  if (dismissed.length > 0) {
    lines.push("## Dismissed Findings");
    lines.push("");
    dismissed.forEach(renderFinding);
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface ReviewDashboardProps {
  workspace: WorkspaceRow;
  onClose: () => void;
}

export default function ReviewDashboard({
  workspace,
  onClose,
}: ReviewDashboardProps) {
  // ─── State ──────────────────────────────────────────────────────────────
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [triaged, setTriaged] = useState<TriagedFinding[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [filterFile, setFilterFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [tone] = useState<ReviewTone>("thorough");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isCompleted = review?.status === "completed";
  const isFailed = review?.status === "failed";
  const isLoading = !isCompleted && !isFailed;

  // ─── Start review ───────────────────────────────────────────────────────

  const startReview = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Tauri not available");
      return;
    }

    setError(null);
    setReview(null);
    setFindings([]);
    setTriaged([]);
    setSelectedFindingId(null);
    setFilterFile(null);

    try {
      let result: { review_id: string };

      if (workspace.pr_number) {
        // PR review: need owner/repo
        const remoteInfo = await getGitRemoteInfo(workspace.repo_path);
        result = await startPrReview(
          remoteInfo.owner,
          remoteInfo.repo,
          workspace.pr_number,
          tone
        );
      } else {
        // Local diff review
        result = await startLocalReview(workspace.repo_path, undefined, tone);
      }

      setReviewId(result.review_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspace, tone]);

  // Auto-start on mount
  useEffect(() => {
    startReview();
  }, [startReview]);

  // ─── Poll for completion ────────────────────────────────────────────────

  useEffect(() => {
    if (!reviewId) return;

    async function poll() {
      try {
        const data = await getReview(reviewId!);
        setReview(data.review);

        if (data.review.status === "completed" || data.review.status === "failed") {
          // Stop polling
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }

          if (data.review.status === "completed" && data.findings.length > 0) {
            setFindings(data.findings);
            setTriaged(
              data.findings.map((f) => ({
                finding: f,
                action: "pending" as FindingAction,
                comment: "",
              }))
            );
          }
        }
      } catch (err) {
        console.error("Failed to poll review:", err);
      }
    }

    // Initial check
    poll();

    // Poll every 2 seconds
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [reviewId]);

  // ─── Computed values ────────────────────────────────────────────────────

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) {
      const sev = (f.severity ?? "info").toLowerCase();
      counts[sev] = (counts[sev] ?? 0) + 1;
    }
    return counts;
  }, [findings]);

  const fileList = useMemo(() => {
    const fileMap = new Map<string, number>();
    for (const f of findings) {
      if (f.file_path) {
        fileMap.set(f.file_path, (fileMap.get(f.file_path) ?? 0) + 1);
      }
    }
    return Array.from(fileMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [findings]);

  const filteredTriaged = useMemo(() => {
    let result = [...triaged];
    if (filterFile) {
      result = result.filter((t) => t.finding.file_path === filterFile);
    }
    // Sort by severity (critical first)
    return result.sort(
      (a, b) => severityRank(a.finding.severity) - severityRank(b.finding.severity)
    );
  }, [triaged, filterFile]);

  const stats = useMemo(() => {
    const accepted = triaged.filter((t) => t.action === "accepted").length;
    const dismissed = triaged.filter((t) => t.action === "dismissed").length;
    const pending = triaged.filter((t) => t.action === "pending").length;
    return { accepted, dismissed, pending, total: triaged.length };
  }, [triaged]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  function handleAction(findingId: string, action: FindingAction) {
    setTriaged((prev) =>
      prev.map((t) =>
        t.finding.id === findingId ? { ...t, action } : t
      )
    );
  }

  function handleComment(findingId: string, comment: string) {
    setTriaged((prev) =>
      prev.map((t) =>
        t.finding.id === findingId ? { ...t, comment } : t
      )
    );
  }

  async function handleExportMarkdown() {
    if (!review) return;
    const md = buildMarkdown(review, triaged, workspace);
    try {
      await navigator.clipboard.writeText(md);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2000);
    } catch {
      // Fallback: create a blob and trigger download
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `review-${workspace.name.replace(/\s+/g, "-")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function handleNewReview() {
    setReviewId(null);
    setReview(null);
    setFindings([]);
    setTriaged([]);
    setSelectedFindingId(null);
    setFilterFile(null);
    setError(null);
    // Re-trigger
    startReview();
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <DashboardHeader
          workspace={workspace}
          review={null}
          onClose={onClose}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-lg">{"\u2717"}</span>
          </div>
          <p className="text-[13px] text-red-400 max-w-md text-center">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewReview}
            className="text-[11px] text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <DashboardHeader
        workspace={workspace}
        review={review}
        onClose={onClose}
      />

      {isLoading ? (
        <ReviewProgress review={review} startedAt={review?.started_at ?? null} />
      ) : (
        <>
          {/* Main content: sidebar + findings */}
          <div className="flex flex-1 min-h-0">
            {/* ── Left Sidebar ── */}
            <div className="w-[220px] shrink-0 border-r border-[#1e2231] flex flex-col overflow-y-auto">
              {/* Severity summary */}
              <div className="p-3 border-b border-[#1e2231]">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
                  Severity
                </div>
                <div className="flex flex-col gap-1.5">
                  {SEVERITY_ORDER.filter((s) => severityCounts[s])
                    .map((s) => {
                      const config = getSevConfig(s);
                      return (
                        <button
                          key={s}
                          onClick={() => setFilterFile(null)}
                          className="flex items-center gap-2 text-[12px] hover:bg-[#1a1d27] rounded-md px-2 py-1 transition-colors"
                        >
                          <span className={cn("h-2 w-2 rounded-full", config.dot)} />
                          <span className={config.text}>
                            {severityCounts[s]}
                          </span>
                          <span className="text-slate-500">{config.label}</span>
                        </button>
                      );
                    })}
                </div>
                {findings.length > 0 && (
                  <div className="mt-3">
                    <SeverityBar findings={findings} />
                  </div>
                )}
              </div>

              {/* Score */}
              {review?.score_composite !== null && review?.score_composite !== undefined && (
                <div className="p-3 border-b border-[#1e2231]">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
                    Score
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        review.score_composite >= 8
                          ? "text-emerald-400"
                          : review.score_composite >= 5
                          ? "text-amber-400"
                          : "text-red-400"
                      )}
                    >
                      {review.score_composite.toFixed(1)}
                    </span>
                    <span className="text-[11px] text-slate-500">/10</span>
                  </div>
                </div>
              )}

              {/* File list */}
              <div className="p-3 flex-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
                  Files ({fileList.length})
                </div>
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => setFilterFile(null)}
                    className={cn(
                      "flex items-center gap-2 text-left px-2 py-1 rounded-md text-[11px] transition-colors",
                      filterFile === null
                        ? "bg-amber-500/10 text-amber-400"
                        : "text-slate-500 hover:text-slate-300 hover:bg-[#1a1d27]"
                    )}
                  >
                    All files
                    <span className="ml-auto text-[10px] text-slate-600">{findings.length}</span>
                  </button>
                  {fileList.map(([file, count]) => {
                    const fileName = file.split("/").pop() ?? file;
                    return (
                      <button
                        key={file}
                        onClick={() => setFilterFile(file === filterFile ? null : file)}
                        title={file}
                        className={cn(
                          "flex items-center gap-2 text-left px-2 py-1 rounded-md text-[11px] transition-colors min-w-0",
                          filterFile === file
                            ? "bg-amber-500/10 text-amber-400"
                            : "text-slate-500 hover:text-slate-300 hover:bg-[#1a1d27]"
                        )}
                      >
                        <span className="truncate">{fileName}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-slate-600">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Triage stats */}
              <div className="p-3 border-t border-[#1e2231]">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
                  Triage Progress
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-emerald-400">Accepted</span>
                    <span className="text-emerald-400 tabular-nums">{stats.accepted}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-red-400">Dismissed</span>
                    <span className="text-red-400 tabular-nums">{stats.dismissed}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Pending</span>
                    <span className="text-slate-500 tabular-nums">{stats.pending}</span>
                  </div>
                </div>
                {/* Progress bar */}
                {stats.total > 0 && (
                  <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[#1e2231]">
                    {stats.accepted > 0 && (
                      <div
                        className="bg-emerald-500 transition-all"
                        style={{ width: `${(stats.accepted / stats.total) * 100}%` }}
                      />
                    )}
                    {stats.dismissed > 0 && (
                      <div
                        className="bg-red-500/60 transition-all"
                        style={{ width: `${(stats.dismissed / stats.total) * 100}%` }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Main Content: Finding Cards ── */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              {/* Summary markdown */}
              {review?.summary_markdown && (
                <div className="p-4 border-b border-[#1e2231]">
                  <div className="rounded-xl border border-[#1e2231] bg-[#0f1117] p-4">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      Summary
                    </h3>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-400">
                      {review.summary_markdown}
                    </p>
                  </div>
                </div>
              )}

              {/* Filter indicator */}
              {filterFile && (
                <div className="px-4 pt-3">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-slate-500">Filtered by:</span>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border-amber-500/20"
                    >
                      {filterFile}
                    </Badge>
                    <button
                      onClick={() => setFilterFile(null)}
                      className="text-slate-500 hover:text-slate-300 text-[11px]"
                    >
                      {"\u2715"} Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Findings list */}
              {filteredTriaged.length > 0 ? (
                <div className="p-4 flex flex-col gap-3">
                  {filteredTriaged.map((t) => (
                    <FindingCard
                      key={t.finding.id}
                      triaged={t}
                      isSelected={selectedFindingId === t.finding.id}
                      onSelect={() =>
                        setSelectedFindingId(
                          selectedFindingId === t.finding.id ? null : t.finding.id
                        )
                      }
                      onAction={(action) => handleAction(t.finding.id, action)}
                      onComment={(comment) => handleComment(t.finding.id, comment)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <p className="text-[14px] text-emerald-400 font-medium">
                    No findings
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1">
                    {filterFile
                      ? "No findings for this file. Try clearing the filter."
                      : "Clean code -- no issues detected!"}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Bottom Bar ── */}
          <div className="shrink-0 border-t border-[#1e2231] bg-[#0e0f13] px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-slate-400">
                {stats.total} finding{stats.total !== 1 ? "s" : ""}
              </span>
              {stats.accepted > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                >
                  {stats.accepted} accepted
                </Badge>
              )}
              {stats.dismissed > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-red-400 bg-red-500/10 border-red-500/20"
                >
                  {stats.dismissed} dismissed
                </Badge>
              )}
              {stats.pending > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-slate-400 bg-slate-500/10 border-slate-500/20"
                >
                  {stats.pending} pending
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportMarkdown}
                className="h-auto px-3 py-1.5 text-[11px] font-medium border-[#1e2231] text-slate-400 hover:text-slate-200"
              >
                {exportCopied ? "Copied!" : "Export Markdown"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNewReview}
                className="h-auto px-3 py-1.5 text-[11px] font-medium border-[#1e2231] text-slate-400 hover:text-slate-200"
              >
                New Review
              </Button>
              {workspace.pr_number && stats.accepted > 0 && (
                <Button
                  size="sm"
                  className="h-auto px-4 py-1.5 text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400"
                  onClick={() => {
                    // TODO: Wire to GitHub PR review posting IPC
                    console.log("Post to GitHub:", triaged.filter((t) => t.action === "accepted"));
                  }}
                >
                  Post to GitHub
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Dashboard Header ───────────────────────────────────────────────────────

function DashboardHeader({
  workspace,
  review,
  onClose,
}: {
  workspace: WorkspaceRow;
  review: Review | null;
  onClose: () => void;
}) {
  const completed = review?.status === "completed";
  const fileCount = review?.findings_count ?? 0;

  return (
    <div className="shrink-0 border-b border-[#1e2231] bg-[#0e0f13] px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-slate-100">
            Review: {repoName(workspace.repo_path)}
          </h2>
          <Badge
            variant="outline"
            className="text-[10px] font-mono text-slate-400 border-[#1e2231]"
          >
            {workspace.branch}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {review?.started_at && (
            <span>Started {formatRelativeTime(review.started_at)}</span>
          )}
          {completed && fileCount > 0 && (
            <>
              <span className="text-slate-600">{"·"}</span>
              <span>{fileCount} finding{fileCount !== 1 ? "s" : ""}</span>
            </>
          )}
          <span className="text-slate-600">{"·"}</span>
          <span>{review?.agent_used ?? "AI"}</span>
          {completed && (
            <>
              <span className="text-slate-600">{"·"}</span>
              <Badge
                variant="outline"
                className="text-[9px] text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              >
                Complete
              </Badge>
            </>
          )}
          {review?.status === "analyzing" && (
            <>
              <span className="text-slate-600">{"·"}</span>
              <Badge
                variant="outline"
                className="text-[9px] text-amber-400 bg-amber-500/10 border-amber-500/20"
              >
                Analyzing
              </Badge>
            </>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="h-auto px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300"
      >
        Close
      </Button>
    </div>
  );
}
