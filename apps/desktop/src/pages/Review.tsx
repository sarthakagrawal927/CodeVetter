import { useState, useEffect, useRef, useCallback } from "react";
import ReviewForm from "@/components/review-form";
import FindingCard from "@/components/finding-card";
import ScoreBadge from "@/components/score-badge";
import {
  startLocalReview,
  startPrReview,
  getReview,
  listReviews,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { ReviewTone, Review, ReviewFinding } from "@/lib/tauri-ipc";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Review() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active review being polled
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);

  // Past reviews
  const [pastReviews, setPastReviews] = useState<Review[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load past reviews on mount
  useEffect(() => {
    if (!isTauriAvailable()) return;
    listReviews(10, 0)
      .then(setPastReviews)
      .catch(() => {});
  }, []);

  // Poll for review completion
  const pollReview = useCallback(
    async (reviewId: string) => {
      try {
        const result = await getReview(reviewId);
        setReview(result.review);
        setFindings(result.findings);

        if (
          result.review.status === "completed" ||
          result.review.status === "failed"
        ) {
          // Stop polling
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setIsLoading(false);

          if (result.review.status === "failed") {
            setError(
              result.review.error_message ?? "Review failed for unknown reason"
            );
          }

          // Refresh past reviews list
          listReviews(10, 0)
            .then(setPastReviews)
            .catch(() => {});
        }
      } catch (err) {
        // Ignore transient poll errors
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSubmitLocal(
    repoPath: string,
    diffRange: string,
    tone: ReviewTone
  ) {
    setIsLoading(true);
    setError(null);
    setReview(null);
    setFindings([]);

    try {
      const result = await startLocalReview(repoPath, diffRange, tone);
      setActiveReviewId(result.review_id);

      // Start polling every 2 seconds
      pollRef.current = setInterval(() => {
        pollReview(result.review_id);
      }, 2000);

      // Also poll immediately
      pollReview(result.review_id);
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmitPr(
    owner: string,
    repo: string,
    prNumber: number,
    tone?: string
  ) {
    setIsLoading(true);
    setError(null);
    setReview(null);
    setFindings([]);

    try {
      const result = await startPrReview(owner, repo, prNumber, tone as import("@/lib/tauri-ipc").ReviewTone | undefined);
      setActiveReviewId(result.review_id);

      pollRef.current = setInterval(() => {
        pollReview(result.review_id);
      }, 2000);

      pollReview(result.review_id);
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleViewPastReview(reviewId: string) {
    try {
      const result = await getReview(reviewId);
      setReview(result.review);
      setFindings(result.findings);
      setActiveReviewId(reviewId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleClear() {
    setReview(null);
    setFindings([]);
    setActiveReviewId(null);
    setError(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Count findings by severity
  const severityCounts = findings.reduce(
    (acc, f) => {
      const sev = f.severity ?? "nitpick";
      acc[sev] = (acc[sev] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="flex flex-col gap-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">Code Review</h1>
        <p className="mt-1 text-sm text-slate-500">
          Analyze a local diff or pull request for quality and issues.
        </p>
      </div>

      {/* Form */}
      <div className="max-w-2xl rounded-xl border border-[#1e2231] bg-[#13151c] p-6">
        <ReviewForm
          onSubmitLocal={handleSubmitLocal}
          onSubmitPr={handleSubmitPr}
          isLoading={isLoading}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-2xl rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs text-red-500 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && review?.status === "analyzing" && (
        <div className="max-w-2xl rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <p className="text-sm text-amber-400">
              Analyzing code with Claude...
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {review && review.status === "completed" && (
        <div className="flex flex-col gap-6 fade-in">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">
              Review Results
            </h2>
            <button
              onClick={handleClear}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Score + Summary */}
          <div className="flex gap-6 rounded-xl border border-[#1e2231] bg-[#13151c] p-6">
            {review.score_composite != null && (
              <ScoreBadge score={Math.round(review.score_composite)} size="lg" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-sm font-semibold text-slate-200">
                  Summary
                </h3>
                {review.review_action && (
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      review.review_action === "approve"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : review.review_action === "request_changes"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {review.review_action.replace("_", " ")}
                  </span>
                )}
              </div>
              {review.summary_markdown ? (
                <p className="text-sm leading-relaxed text-slate-400 whitespace-pre-wrap">
                  {review.summary_markdown}
                </p>
              ) : (
                <p className="text-sm text-slate-500 italic">
                  No summary available.
                </p>
              )}
              {Object.keys(severityCounts).length > 0 && (
                <div className="mt-3 flex gap-4 text-xs">
                  {severityCounts.critical && (
                    <span className="text-red-400">
                      {severityCounts.critical} critical
                    </span>
                  )}
                  {severityCounts.warning && (
                    <span className="text-yellow-400">
                      {severityCounts.warning} warning
                    </span>
                  )}
                  {severityCounts.suggestion && (
                    <span className="text-blue-400">
                      {severityCounts.suggestion} suggestion
                    </span>
                  )}
                  {severityCounts.nitpick && (
                    <span className="text-slate-400">
                      {severityCounts.nitpick} nitpick
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Findings */}
          {findings.length > 0 ? (
            <div className="flex flex-col gap-3">
              {findings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 italic">
              No findings - clean code!
            </p>
          )}
        </div>
      )}

      {/* Failed review */}
      {review && review.status === "failed" && !error && (
        <div className="max-w-2xl rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm font-medium text-red-400">Review Failed</p>
          <p className="mt-1 text-xs text-red-400/70">
            {review.error_message ?? "Unknown error"}
          </p>
        </div>
      )}

      {/* Past Reviews */}
      {pastReviews.length > 0 && !review && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-200">
            Recent Reviews
          </h2>
          <div className="flex flex-col gap-2">
            {pastReviews.map((r) => (
              <button
                key={r.id}
                onClick={() => handleViewPastReview(r.id)}
                className="flex items-center justify-between rounded-lg border border-[#1e2231] bg-[#13151c] p-3 text-left transition-colors hover:border-[#2d3348]"
              >
                <div className="flex-1">
                  <p className="text-sm text-slate-300">
                    {r.source_label ?? r.repo_path ?? "Unknown"}
                  </p>
                  <p className="text-xs text-slate-600">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleString()
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {r.score_composite != null && (
                    <ScoreBadge
                      score={Math.round(r.score_composite)}
                      size="sm"
                    />
                  )}
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                      r.status === "completed"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : r.status === "failed"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
