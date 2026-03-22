/**
 * Review service — orchestrates the review pipeline in the webview.
 *
 * Flow: get diff (Tauri IPC) → review-core + ai-gateway-client (browser) → save results (Tauri IPC)
 */

import { AIGatewayClient } from "@code-reviewer/ai-gateway-client";
import {
  computeScore,
  computeFindingFingerprint,
  determineReviewAction,
  buildOverallBody,
  getPrDiffWithPat,
  getPrFilesWithPat,
} from "@code-reviewer/review-core";
import type { GatewayConfig, GatewayReviewRequest, ReviewFinding } from "@code-reviewer/shared-types";
import { getLocalDiff, saveReview, type SaveReviewInput } from "./tauri-ipc";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReviewConfig {
  gatewayBaseUrl: string;
  gatewayApiKey: string;
  gatewayModel: string;
  reviewTone: string;
}

export interface ReviewProgress {
  stage: "idle" | "fetching_diff" | "reviewing" | "saving" | "completed" | "error";
  message?: string;
}

export interface ReviewResult {
  reviewId: string;
  score: number;
  findings: ReviewFinding[];
  action: string;
  summaryMarkdown: string;
}

// ─── Config persistence ─────────────────────────────────────────────────────

const STORAGE_KEY = "codevetter_review_config";

export function loadReviewConfig(): ReviewConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as ReviewConfig;
    if (!config.gatewayApiKey || !config.gatewayBaseUrl) return null;
    return config;
  } catch {
    return null;
  }
}

export function saveReviewConfig(config: ReviewConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ─── Default configs for common providers ───────────────────────────────────

export const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4-20250514",
  },
};

// ─── Review pipeline ────────────────────────────────────────────────────────

function buildGatewayConfig(config: ReviewConfig): GatewayConfig {
  return {
    baseUrl: config.gatewayBaseUrl,
    apiKey: config.gatewayApiKey,
    model: config.gatewayModel,
    reviewTone: config.reviewTone || "balanced",
  };
}

/**
 * Run a local code review on a repository's git diff.
 */
export async function reviewLocalDiff(
  repoPath: string,
  config: ReviewConfig,
  diffRange?: string,
  onProgress?: (p: ReviewProgress) => void,
): Promise<ReviewResult> {
  onProgress?.({ stage: "fetching_diff", message: "Getting git diff..." });

  const diffResult = await getLocalDiff(repoPath, diffRange);
  if (diffResult.empty) {
    throw new Error("No changes to review. Make some changes and try again.");
  }

  const request: GatewayReviewRequest = {
    diff: diffResult.diff,
    files: diffResult.files.map((f) => ({ path: f.path, status: f.status })),
    context: {
      reviewTone: config.reviewTone || "balanced",
    },
  };

  onProgress?.({ stage: "reviewing", message: "AI is reviewing your code..." });

  const gateway = new AIGatewayClient(buildGatewayConfig(config));
  const response = await gateway.reviewDiff(request);

  // Add fingerprints
  const findings = response.findings.map((f) => ({
    ...f,
    fingerprint: computeFindingFingerprint(f),
  }));

  const score = computeScore(findings);
  const action = determineReviewAction(findings, score, "standard");
  const summaryMarkdown = buildOverallBody(findings, score, undefined, action);

  onProgress?.({ stage: "saving", message: "Saving results..." });

  // Persist via Tauri IPC
  const saveInput: SaveReviewInput = {
    repoPath,
    sourceLabel: diffRange || "working tree",
    reviewType: "local_diff",
    score,
    findings: findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      summary: f.summary,
      suggestion: f.suggestion,
      filePath: f.filePath,
      line: f.line,
      confidence: f.confidence,
      fingerprint: f.fingerprint ?? computeFindingFingerprint(f),
    })),
    reviewAction: action,
    summaryMarkdown,
  };

  const saved = await saveReview(saveInput);

  onProgress?.({ stage: "completed", message: "Review complete!" });

  return {
    reviewId: saved.review_id,
    score,
    findings,
    action,
    summaryMarkdown,
  };
}

/**
 * Run a review on a GitHub pull request using a PAT.
 */
export async function reviewPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  githubPat: string,
  config: ReviewConfig,
  onProgress?: (p: ReviewProgress) => void,
): Promise<ReviewResult> {
  onProgress?.({ stage: "fetching_diff", message: "Fetching PR diff from GitHub..." });

  const [diff, files] = await Promise.all([
    getPrDiffWithPat(githubPat, owner, repo, prNumber),
    getPrFilesWithPat(githubPat, owner, repo, prNumber),
  ]);

  if (!diff || !diff.trim()) {
    throw new Error("PR has no diff content.");
  }

  const request: GatewayReviewRequest = {
    diff,
    files: files.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    })),
    context: {
      repoFullName: `${owner}/${repo}`,
      prNumber,
      reviewTone: config.reviewTone || "balanced",
    },
  };

  onProgress?.({ stage: "reviewing", message: "AI is reviewing the PR..." });

  const gateway = new AIGatewayClient(buildGatewayConfig(config));
  const response = await gateway.reviewDiff(request);

  const findings = response.findings.map((f) => ({
    ...f,
    fingerprint: computeFindingFingerprint(f),
  }));

  const score = computeScore(findings);
  const action = determineReviewAction(findings, score, "standard");
  const summaryMarkdown = buildOverallBody(findings, score, undefined, action);

  onProgress?.({ stage: "saving", message: "Saving results..." });

  const saveInput: SaveReviewInput = {
    sourceLabel: `${owner}/${repo}#${prNumber}`,
    reviewType: "local_pr",
    repoFullName: `${owner}/${repo}`,
    prNumber,
    score,
    findings: findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      summary: f.summary,
      suggestion: f.suggestion,
      filePath: f.filePath,
      line: f.line,
      confidence: f.confidence,
      fingerprint: f.fingerprint ?? computeFindingFingerprint(f),
    })),
    reviewAction: action,
    summaryMarkdown,
  };

  const saved = await saveReview(saveInput);

  onProgress?.({ stage: "completed", message: "Review complete!" });

  return {
    reviewId: saved.review_id,
    score,
    findings,
    action,
    summaryMarkdown,
  };
}
