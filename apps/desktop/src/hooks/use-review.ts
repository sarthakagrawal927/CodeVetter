import { useState, useCallback } from "react";
import {
  reviewLocalDiff,
  reviewPullRequest,
  loadReviewConfig,
  type ReviewConfig,
  type ReviewProgress,
  type ReviewResult,
} from "@/lib/review-service";

export function useReview() {
  const [progress, setProgress] = useState<ReviewProgress>({ stage: "idle" });
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewLocal = useCallback(
    async (repoPath: string, diffRange?: string) => {
      const config = loadReviewConfig();
      if (!config) {
        setError("No AI provider configured. Go to Settings to add your API key.");
        return null;
      }

      setError(null);
      setResult(null);
      setProgress({ stage: "fetching_diff" });

      try {
        const r = await reviewLocalDiff(repoPath, config, diffRange, setProgress);
        setResult(r);
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgress({ stage: "error", message: msg });
        return null;
      }
    },
    [],
  );

  const reviewPR = useCallback(
    async (owner: string, repo: string, prNumber: number, githubPat: string) => {
      const config = loadReviewConfig();
      if (!config) {
        setError("No AI provider configured. Go to Settings to add your API key.");
        return null;
      }

      setError(null);
      setResult(null);
      setProgress({ stage: "fetching_diff" });

      try {
        const r = await reviewPullRequest(owner, repo, prNumber, githubPat, config, setProgress);
        setResult(r);
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setProgress({ stage: "error", message: msg });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setProgress({ stage: "idle" });
    setResult(null);
    setError(null);
  }, []);

  return {
    progress,
    result,
    error,
    reviewLocal,
    reviewPR,
    reset,
    isReviewing: progress.stage !== "idle" && progress.stage !== "completed" && progress.stage !== "error",
  };
}
