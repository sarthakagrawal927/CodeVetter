import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ScoreBadge from "@/components/score-badge";
import FindingCard from "@/components/finding-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  listReviews,
  getReview,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { LocalReviewRow, LocalReviewFindingRow } from "@/lib/tauri-ipc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  if (diffDay < 30) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

function extractRepoName(review: LocalReviewRow): string {
  if (review.repo_full_name) return review.repo_full_name;
  if (review.repo_path) {
    const parts = review.repo_path.split("/");
    return parts[parts.length - 1] || review.repo_path;
  }
  return review.source_label ?? "Review";
}

function shortenPath(path: string): string {
  const home = "/Users/";
  if (path.startsWith(home)) {
    const afterHome = path.slice(home.length);
    const slashIdx = afterHome.indexOf("/");
    if (slashIdx >= 0) return "~" + afterHome.slice(slashIdx);
  }
  return path;
}

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  warning: 3,
  low: 4,
  suggestion: 5,
  info: 6,
  nitpick: 7,
};

function severityColor(s: string): string {
  switch (s) {
    case "critical": return "text-red-400 bg-red-500/10";
    case "high": return "text-orange-400 bg-orange-500/10";
    case "medium": return "text-yellow-400 bg-yellow-500/10";
    case "warning": return "text-yellow-400 bg-yellow-500/10";
    case "low": return "text-blue-400 bg-blue-500/10";
    default: return "text-slate-400 bg-slate-500/10";
  }
}

type RepoFilter = "all" | string;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Reviews() {
  // List state
  const [reviews, setReviews] = useState<LocalReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const PAGE_SIZE = 50;

  // Detail state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findings, setFindings] = useState<LocalReviewFindingRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filter
  const [repoFilter, setRepoFilter] = useState<RepoFilter>("all");

  // Keyboard nav
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Unique repos for filter
  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const r of reviews) {
      const name = extractRepoName(r);
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [reviews]);

  // Filtered list
  const filtered = useMemo(() => {
    if (repoFilter === "all") return reviews;
    return reviews.filter((r) => extractRepoName(r) === repoFilter);
  }, [reviews, repoFilter]);

  // Score trend (last N reviews, oldest first)
  const scoreTrend = useMemo(() => {
    return filtered
      .filter((r) => r.score_composite != null)
      .slice(0, 20)
      .reverse();
  }, [filtered]);

  // Severity breakdown
  const severityBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      // We don't have per-finding severity in the list, so use findings_count
    }
    return counts;
  }, [filtered]);

  // Stats
  const stats = useMemo(() => {
    const completed = filtered.filter((r) => r.status === "completed");
    const scores = completed
      .map((r) => r.score_composite)
      .filter((s): s is number => s != null);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
    const totalFindings = completed.reduce(
      (sum, r) => sum + (r.findings_count ?? 0),
      0
    );
    return { total: completed.length, avgScore, totalFindings };
  }, [filtered]);

  // Load reviews
  const loadReviews = useCallback(async (reset = false) => {
    if (!isTauriAvailable()) {
      setError("Not running in Tauri");
      setLoading(false);
      return;
    }
    try {
      if (reset) {
        offsetRef.current = 0;
        setLoading(true);
      }
      const rows = await listReviews(PAGE_SIZE, offsetRef.current);
      if (reset) {
        setReviews(rows);
      } else {
        setReviews((prev) => [...prev, ...rows]);
      }
      setHasMore(rows.length === PAGE_SIZE);
      offsetRef.current += rows.length;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadReviews(true);
  }, [loadReviews]);

  // Load more on scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!hasMore || loadingMore) return;
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        setLoadingMore(true);
        loadReviews(false);
      }
    },
    [hasMore, loadingMore, loadReviews]
  );

  // Select review → load findings
  const selectReview = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const result = await getReview(id);
      setFindings(result.findings ?? []);
    } catch {
      setFindings([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Keyboard navigation (j/k/Enter)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[focusIdx]) selectReview(filtered[focusIdx].id);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, focusIdx, selectReview]);

  const selectedReview = filtered.find((r) => r.id === selectedId);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Left panel: review list */}
      <div className="flex w-[420px] shrink-0 flex-col border-r border-[#1a1a1a]">
        {/* Header + stats */}
        <div className="shrink-0 border-b border-[#1a1a1a] px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-semibold text-slate-200">Reviews</h1>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {stats.total} reviews
            </span>
          </div>

          {/* Stats row */}
          {stats.total > 0 && (
            <div className="mt-2 flex items-center gap-4 text-[11px]">
              {stats.avgScore != null && (
                <span className="text-slate-400">
                  Avg score:{" "}
                  <span className={cn(
                    "font-semibold",
                    stats.avgScore >= 80 ? "text-emerald-400" :
                    stats.avgScore >= 60 ? "text-yellow-400" :
                    stats.avgScore >= 40 ? "text-orange-400" : "text-red-400"
                  )}>
                    {stats.avgScore}
                  </span>
                </span>
              )}
              <span className="text-slate-500">
                {stats.totalFindings} total findings
              </span>
            </div>
          )}

          {/* Score trend sparkline */}
          {scoreTrend.length >= 2 && (
            <div className="mt-2">
              <ScoreTrend reviews={scoreTrend} />
            </div>
          )}

          {/* Repo filter */}
          {repos.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <button
                onClick={() => setRepoFilter("all")}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                  repoFilter === "all"
                    ? "bg-amber-500/15 text-amber-400"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                All
              </button>
              {repos.map((r) => (
                <button
                  key={r}
                  onClick={() => setRepoFilter(r)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors truncate max-w-[120px]",
                    repoFilter === r
                      ? "bg-amber-500/15 text-amber-400"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Review list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-sm text-red-400">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No reviews yet. Run a review from a workspace to get started.
            </div>
          ) : (
            filtered.map((review, idx) => (
              <ReviewRow
                key={review.id}
                review={review}
                selected={review.id === selectedId}
                focused={idx === focusIdx}
                onClick={() => {
                  setFocusIdx(idx);
                  selectReview(review.id);
                }}
              />
            ))
          )}
          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            </div>
          )}
        </div>
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 overflow-y-auto">
        {selectedReview ? (
          <ReviewDetail
            review={selectedReview}
            findings={findings}
            loading={detailLoading}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Select a review to see findings
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ReviewRow ────────────────────────────────────────────────────────────────

function ReviewRow({
  review,
  selected,
  focused,
  onClick,
}: {
  review: LocalReviewRow;
  selected: boolean;
  focused: boolean;
  onClick: () => void;
}) {
  const score = review.score_composite;
  const scoreColor =
    score == null ? "text-slate-500" :
    score >= 80 ? "text-emerald-400" :
    score >= 60 ? "text-yellow-400" :
    score >= 40 ? "text-orange-400" : "text-red-400";

  const typeLabel = review.review_type === "pr" ? "PR" : "Local";

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col px-3 py-2 text-left transition-colors border-l-2 overflow-hidden",
        selected
          ? "bg-amber-500/8 border-l-amber-400"
          : focused
          ? "bg-[#111111] border-l-transparent"
          : "border-l-transparent hover:bg-[#111111]"
      )}
    >
      {/* Row 1: repo, type badge, score, age */}
      <div className="flex w-full items-center gap-2 text-[13px]">
        {score != null && (
          <span className={cn("shrink-0 text-sm font-bold tabular-nums w-[28px]", scoreColor)}>
            {Math.round(score)}
          </span>
        )}

        <span className="truncate font-medium text-slate-200 min-w-0">
          {extractRepoName(review)}
        </span>

        <span className="flex-1" />

        <span className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
          review.review_type === "pr"
            ? "bg-purple-500/10 text-purple-400"
            : "bg-blue-500/10 text-blue-400"
        )}>
          {typeLabel}
        </span>

        <span className="shrink-0 text-[11px] text-slate-600 tabular-nums">
          {formatRelativeTime(review.created_at)}
        </span>
      </div>

      {/* Row 2: source label, findings count */}
      <div className="flex items-center gap-2 mt-0.5">
        {review.source_label && (
          <span className="truncate text-[11px] text-slate-500 max-w-[240px]">
            {review.source_label}
          </span>
        )}
        <span className="flex-1" />
        {review.findings_count != null && review.findings_count > 0 && (
          <span className="text-[11px] text-slate-500 tabular-nums">
            {review.findings_count} finding{review.findings_count !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── ReviewDetail ─────────────────────────────────────────────────────────────

function ReviewDetail({
  review,
  findings,
  loading,
}: {
  review: LocalReviewRow;
  findings: LocalReviewFindingRow[];
  loading: boolean;
}) {
  // Sort findings by severity
  const sorted = useMemo(
    () =>
      [...findings].sort(
        (a, b) =>
          (severityOrder[a.severity ?? "info"] ?? 99) -
          (severityOrder[b.severity ?? "info"] ?? 99)
      ),
    [findings]
  );

  // Severity counts
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) {
      const s = f.severity ?? "info";
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [findings]);

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        {review.score_composite != null && (
          <ScoreBadge score={Math.round(review.score_composite)} size="lg" />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-200 truncate">
            {extractRepoName(review)}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {review.review_type && (
              <Badge variant="outline" className="text-[10px]">
                {review.review_type === "pr" ? "PR Review" : "Local Diff"}
              </Badge>
            )}
            {review.pr_number && (
              <span>#{review.pr_number}</span>
            )}
            {review.repo_path && (
              <span className="font-mono truncate max-w-[300px]">
                {shortenPath(review.repo_path)}
              </span>
            )}
            {review.created_at && (
              <span>{new Date(review.created_at).toLocaleString()}</span>
            )}
          </div>
          {review.review_action && (
            <div className="mt-1.5">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  review.review_action === "approve"
                    ? "border-emerald-500/30 text-emerald-400"
                    : "border-orange-500/30 text-orange-400"
                )}
              >
                {review.review_action === "approve" ? "Approved" : "Changes Requested"}
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Severity bar */}
      {findings.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-2">
            {Object.entries(severityCounts)
              .sort(
                ([a], [b]) =>
                  (severityOrder[a] ?? 99) - (severityOrder[b] ?? 99)
              )
              .map(([sev, count]) => (
                <span
                  key={sev}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    severityColor(sev)
                  )}
                >
                  {count} {sev}
                </span>
              ))}
          </div>
          <SeverityBar counts={severityCounts} total={findings.length} />
        </div>
      )}

      {/* Findings */}
      <div className="mt-6 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-slate-500">No findings — clean review.</p>
        ) : (
          sorted.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── ScoreTrend ───────────────────────────────────────────────────────────────

function ScoreTrend({ reviews }: { reviews: LocalReviewRow[] }) {
  const scores = reviews
    .map((r) => r.score_composite)
    .filter((s): s is number => s != null);

  if (scores.length < 2) return null;

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const h = 32;
  const w = 200;
  const step = w / (scores.length - 1);

  const points = scores.map((s, i) => {
    const x = i * step;
    const y = h - ((s - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });

  const lastScore = scores[scores.length - 1];
  const firstScore = scores[0];
  const trending = lastScore >= firstScore;

  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} className="shrink-0">
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke={trending ? "#34d399" : "#f87171"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dots on first and last */}
        <circle
          cx={0}
          cy={h - ((firstScore - min) / range) * (h - 4) - 2}
          r="2"
          fill={trending ? "#34d399" : "#f87171"}
        />
        <circle
          cx={(scores.length - 1) * step}
          cy={h - ((lastScore - min) / range) * (h - 4) - 2}
          r="2.5"
          fill={trending ? "#34d399" : "#f87171"}
        />
      </svg>
      <span className={cn(
        "text-[10px] font-medium",
        trending ? "text-emerald-400" : "text-red-400"
      )}>
        {trending ? "+" : ""}{lastScore - firstScore}
      </span>
    </div>
  );
}

// ─── SeverityBar ──────────────────────────────────────────────────────────────

function SeverityBar({
  counts,
  total,
}: {
  counts: Record<string, number>;
  total: number;
}) {
  const ordered = ["critical", "high", "medium", "warning", "low", "suggestion", "info", "nitpick"];
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    warning: "bg-yellow-500",
    low: "bg-blue-500",
    suggestion: "bg-cyan-500",
    info: "bg-slate-500",
    nitpick: "bg-slate-600",
  };

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#1a1a1a]">
      {ordered.map((sev) => {
        const count = counts[sev];
        if (!count) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={sev}
            className={cn("h-full transition-all", colors[sev] ?? "bg-slate-500")}
            style={{ width: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}
