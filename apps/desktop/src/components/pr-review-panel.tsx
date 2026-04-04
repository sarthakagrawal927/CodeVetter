import { useState, useEffect, useCallback } from "react";
import {
  getGitRemoteInfo,
  getPreference,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow } from "@/lib/tauri-ipc";
import {
  reviewPullRequest,
  loadReviewConfig,
  type ReviewProgress,
  type ReviewResult,
} from "@/lib/review-service";
import {
  postPrReview,
  type ReviewComment,
} from "@code-reviewer/review-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ScoreBadge from "@/components/score-badge";
import FindingCard from "@/components/finding-card";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GitHubPR {
  number: number;
  title: string;
  user: { login: string } | null;
  created_at: string;
  head: { sha: string; ref: string };
  base: { ref: string };
}

interface PrReviewPanelProps {
  workspace: WorkspaceRow;
  onClose: () => void;
}

/** Extended finding type — review-service adds `fingerprint` at runtime */
type FindingWithFingerprint = ReviewResult["findings"][number] & {
  fingerprint?: string;
};

// ─── GitHub API: fetch open PRs ─────────────────────────────────────────────

async function fetchOpenPRs(
  owner: string,
  repo: string,
  pat: string,
): Promise<GitHubPR[]> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&per_page=30`,
    {
      headers: {
        authorization: `Bearer ${pat}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "code-reviewer/1.0",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to fetch PRs (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  return response.json();
}

// ─── Severity Config (for summary) ─────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  string,
  { dot: string; text: string; bg: string; border: string; label: string }
> = {
  critical: { dot: "bg-red-500", text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", label: "Critical" },
  high: { dot: "bg-rose-500", text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "High" },
  medium: { dot: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Medium" },
  warning: { dot: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Warning" },
  low: { dot: "bg-slate-500", text: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", label: "Low" },
  suggestion: { dot: "bg-blue-500", text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", label: "Suggestion" },
  info: { dot: "bg-slate-500", text: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", label: "Info" },
};

function getSevConfig(severity: string | null) {
  return SEVERITY_CONFIG[(severity ?? "info").toLowerCase()] ?? SEVERITY_CONFIG.info;
}

// ─── Progress Steps ─────────────────────────────────────────────────────────

function ProgressIndicator({ progress }: { progress: ReviewProgress }) {
  const stages = [
    { key: "fetching_diff", label: "Fetching diff" },
    { key: "reviewing", label: "AI review" },
    { key: "saving", label: "Saving" },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="relative">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <div className="absolute inset-0 h-10 w-10 animate-ping rounded-full border border-amber-500/20" />
      </div>
      <p className="text-[14px] font-medium text-slate-200">
        {progress.message || "Analyzing PR..."}
      </p>
      <div className="flex gap-6 text-[11px] text-slate-500 mt-2">
        {stages.map((s, i) => (
          <span key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-600">{">"}</span>}
            <span className={progress.stage === s.key ? "text-amber-400 font-medium" : ""}>
              {s.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── PR List Item ───────────────────────────────────────────────────────────

function PrListItem({
  pr,
  isSelected,
  onSelect,
}: {
  pr: GitHubPR;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const age = formatRelativeTime(pr.created_at);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
        isSelected
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-[#1a1a1a] bg-[#0a0a0a] hover:border-[#2a2e3d]",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-slate-200 truncate">
            #{pr.number}
          </span>
          <span className="text-[13px] text-slate-300 truncate flex-1">
            {pr.title}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
          <span className="font-mono">{pr.head.ref}</span>
          <span className="text-slate-600">{"<-"}</span>
          <span className="font-mono">{pr.base.ref}</span>
          {pr.user && (
            <>
              <span className="text-slate-600">{"·"}</span>
              <span>{pr.user.login}</span>
            </>
          )}
          <span className="text-slate-600">{"·"}</span>
          <span>{age}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Severity Summary Bar ───────────────────────────────────────────────────

function SeverityBar({ findings }: { findings: ReviewResult["findings"] }) {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const sev = (f.severity ?? "info").toLowerCase();
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  const total = findings.length;
  if (total === 0) return null;

  const order = ["critical", "high", "medium", "warning", "low", "suggestion", "info"];
  const segments = order
    .filter((s) => counts[s])
    .map((s) => ({ severity: s, count: counts[s], pct: (counts[s] / total) * 100 }));

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[#1a1a1a]">
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

// TODO: When a workspace task has a `pr_number` field, the review loop
// (review-loop.ts) should use PR review instead of local diff review.
// This integration is left as a follow-up — don't modify review-loop.ts here.

export default function PrReviewPanel({ workspace, onClose }: PrReviewPanelProps) {
  // ─── Remote info (auto-detected) ────────────────────────────────────────
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [remoteDetected, setRemoteDetected] = useState(false);

  // ─── PR list ────────────────────────────────────────────────────────────
  const [prs, setPrs] = useState<GitHubPR[]>([]);
  const [loadingPrs, setLoadingPrs] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

  // ─── Manual PR number input ─────────────────────────────────────────────
  const [manualPrNumber, setManualPrNumber] = useState("");

  // ─── Review state ───────────────────────────────────────────────────────
  const [progress, setProgress] = useState<ReviewProgress>({ stage: "idle" });
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Post to GitHub state ───────────────────────────────────────────────
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const isReviewing =
    progress.stage !== "idle" &&
    progress.stage !== "completed" &&
    progress.stage !== "error";

  const selectedPr = prs.find((p) => p.number === selectedPrNumber) ?? null;
  const activePrNumber = selectedPrNumber ?? (manualPrNumber ? parseInt(manualPrNumber, 10) : null);

  // ─── Auto-detect remote + load PAT ─────────────────────────────────────

  useEffect(() => {
    if (!isTauriAvailable()) return;

    async function init() {
      try {
        const [remoteInfo, pat] = await Promise.all([
          getGitRemoteInfo(workspace.repo_path),
          getPreference("github_token"),
        ]);

        setOwner(remoteInfo.owner);
        setRepo(remoteInfo.repo);
        setRemoteDetected(true);

        if (pat) {
          setGithubPat(pat);
        }
      } catch {
        // Remote detection failed — user can enter manually
      }
    }

    init();
  }, [workspace.repo_path]);

  // ─── Fetch open PRs ───────────────────────────────────────────────────

  const handleFetchPrs = useCallback(async () => {
    if (!owner || !repo || !githubPat) return;

    setLoadingPrs(true);
    setPrError(null);

    try {
      const fetchedPrs = await fetchOpenPRs(owner, repo, githubPat);
      setPrs(fetchedPrs);
      if (fetchedPrs.length > 0 && !selectedPrNumber) {
        setSelectedPrNumber(fetchedPrs[0].number);
      }
    } catch (e) {
      setPrError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingPrs(false);
    }
  }, [owner, repo, githubPat, selectedPrNumber]);

  // Auto-fetch PRs when remote + PAT are available
  useEffect(() => {
    if (owner && repo && githubPat && prs.length === 0 && !prError) {
      handleFetchPrs();
    }
  }, [owner, repo, githubPat]);

  // ─── Start review ─────────────────────────────────────────────────────

  const handleStartReview = useCallback(async () => {
    if (!activePrNumber || !owner || !repo) return;

    const config = loadReviewConfig();
    if (!config) {
      setError("No AI provider configured. Go to Settings to add your API key.");
      return;
    }

    if (!githubPat) {
      setError("No GitHub token configured. Set one in Settings > Integrations > GitHub.");
      return;
    }

    setError(null);
    setResult(null);
    setPosted(false);
    setPostError(null);

    try {
      const r = await reviewPullRequest(
        owner,
        repo,
        activePrNumber,
        githubPat,
        config,
        setProgress,
        workspace.id,
      );
      setResult(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setProgress({ stage: "error", message: msg });
    }
  }, [activePrNumber, owner, repo, githubPat, workspace.id]);

  // ─── Post review to GitHub ────────────────────────────────────────────

  const handlePostToGitHub = useCallback(async () => {
    if (!result || !activePrNumber || !selectedPr) return;

    setPosting(true);
    setPostError(null);

    try {
      // Build inline comments from findings that have file paths + line numbers
      const comments: ReviewComment[] = result.findings
        .filter((f) => f.filePath && f.line && f.line > 0)
        .map((f) => ({
          path: f.filePath!,
          line: f.line!,
          body: `**[${(f.severity ?? "info").toUpperCase()}]** ${f.title}\n\n${f.summary ?? ""}${f.suggestion ? `\n\n**Suggestion:**\n\`\`\`\n${f.suggestion}\n\`\`\`` : ""}`,
        }));

      await postPrReview(
        githubPat,
        owner,
        repo,
        activePrNumber,
        selectedPr.head.sha,
        comments,
        result.summaryMarkdown,
      );

      setPosted(true);
    } catch (e) {
      setPostError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }, [result, activePrNumber, selectedPr, githubPat, owner, repo]);

  // ─── Reset ────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    setProgress({ stage: "idle" });
    setResult(null);
    setError(null);
    setPosted(false);
    setPostError(null);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1a1a1a] bg-[#0e0f13] px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-auto px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300"
          >
            {"<"} Back
          </Button>
          <h2 className="text-[14px] font-semibold text-slate-100">PR Review</h2>
          {owner && repo && (
            <span className="text-[12px] text-slate-500 font-mono">
              {owner}/{repo}
            </span>
          )}
        </div>
        {result && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="h-auto px-2.5 py-1 text-[11px] text-slate-500 hover:text-slate-300"
          >
            New Review
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* ── No PAT warning ─────────────────────────────────────────── */}
        {!githubPat && !isReviewing && !result && (
          <Card className="border-amber-500/20 bg-amber-500/5 mb-4">
            <CardContent className="p-4">
              <p className="text-[13px] text-amber-400">
                No GitHub token found. Configure one in Settings {">"} Integrations {">"} GitHub to fetch PRs and post reviews.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Setup: owner/repo + PR selection ───────────────────────── */}
        {!isReviewing && !result && (
          <div className="flex flex-col gap-5 max-w-2xl">
            {/* Owner/repo fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Owner</label>
                <input
                  type="text"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="octocat"
                  className="font-mono rounded-lg border border-[#1a1a1a] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">Repository</label>
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="my-project"
                  className="font-mono rounded-lg border border-[#1a1a1a] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
                />
              </div>
            </div>

            {remoteDetected && (
              <div className="flex items-center gap-2 -mt-3">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[11px] text-slate-500">
                  Auto-detected from workspace git remote
                </span>
              </div>
            )}

            {/* Fetch PRs button */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchPrs}
                disabled={!owner || !repo || !githubPat || loadingPrs}
                className="h-auto px-3 py-1.5 text-[12px] font-medium border-[#1a1a1a] bg-[#0f1117] text-slate-300 hover:text-slate-100 hover:bg-[#111111] disabled:opacity-50"
              >
                {loadingPrs ? "Fetching..." : "Fetch Open PRs"}
              </Button>
              {prError && (
                <span className="text-[11px] text-red-400">{prError}</span>
              )}
            </div>

            {/* PR list */}
            {prs.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-300">
                  Open Pull Requests ({prs.length})
                </label>
                <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto pr-1">
                  {prs.map((pr) => (
                    <PrListItem
                      key={pr.number}
                      pr={pr}
                      isSelected={selectedPrNumber === pr.number}
                      onSelect={() => setSelectedPrNumber(pr.number)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Manual PR number fallback */}
            {prs.length === 0 && !loadingPrs && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">
                  PR Number
                </label>
                <input
                  type="number"
                  value={manualPrNumber}
                  onChange={(e) => setManualPrNumber(e.target.value)}
                  placeholder="42"
                  min={1}
                  className="font-mono w-32 rounded-lg border border-[#1a1a1a] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
                />
                <p className="text-[11px] text-slate-500">
                  Enter a PR number directly, or fetch the list above.
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <Card className="border-red-500/20 bg-red-500/5">
                <CardContent className="p-3">
                  <p className="text-[12px] text-red-400">{error}</p>
                </CardContent>
              </Card>
            )}

            {/* Start Review button */}
            <Button
              onClick={handleStartReview}
              disabled={!activePrNumber || !owner || !repo || !githubPat || isReviewing}
              className="self-start mt-1 rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Review
            </Button>
          </div>
        )}

        {/* ── Progress ───────────────────────────────────────────────── */}
        {isReviewing && <ProgressIndicator progress={progress} />}

        {/* ── Results ────────────────────────────────────────────────── */}
        {result && (
          <div className="flex flex-col gap-6 max-w-3xl">
            {/* Score header */}
            <div className="flex items-center gap-6">
              <ScoreBadge score={result.score} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-[16px] font-semibold text-slate-100">
                  {owner}/{repo} #{activePrNumber}
                </h3>
                {selectedPr && (
                  <p className="text-[13px] text-slate-400 mt-0.5 truncate">
                    {selectedPr.title}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-[12px] text-slate-500">
                  <span>{result.findings.length} findings</span>
                  <span className="text-slate-600">{"·"}</span>
                  <span className="capitalize">{result.action.replace(/_/g, " ")}</span>
                </div>
                <div className="mt-2 w-full max-w-xs">
                  <SeverityBar findings={result.findings} />
                </div>
              </div>
            </div>

            {/* Post to GitHub */}
            <div className="flex items-center gap-3">
              {!posted ? (
                <Button
                  onClick={handlePostToGitHub}
                  disabled={posting || !selectedPr}
                  className="h-auto px-4 py-2 text-[12px] font-semibold bg-[#238636] text-white hover:bg-[#2ea043] disabled:opacity-50"
                >
                  {posting ? "Posting..." : "Post Review to GitHub"}
                </Button>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[11px] text-emerald-400 bg-emerald-500/10 border-emerald-500/20 px-3 py-1"
                >
                  Posted to GitHub
                </Badge>
              )}
              {!selectedPr && !posted && (
                <span className="text-[11px] text-slate-500">
                  (Only available when PR is selected from list)
                </span>
              )}
              {postError && (
                <span className="text-[11px] text-red-400">{postError}</span>
              )}
            </div>

            {/* Findings */}
            <div className="flex flex-col gap-3">
              <h4 className="text-[13px] font-medium text-slate-300 uppercase tracking-wider">
                Findings
              </h4>
              {result.findings.length === 0 ? (
                <p className="text-[13px] text-slate-500 py-4">
                  No issues found. The code looks good.
                </p>
              ) : (
                result.findings.map((rawFinding, i) => {
                  const finding = rawFinding as FindingWithFingerprint;
                  return (
                    <FindingCard
                      key={finding.fingerprint ?? `f-${i}`}
                      finding={{
                        id: finding.fingerprint ?? `f-${i}`,
                        review_id: result.reviewId,
                        severity: finding.severity,
                        title: finding.title,
                        summary: finding.summary,
                        suggestion: finding.suggestion ?? null,
                        file_path: finding.filePath ?? null,
                        line: finding.line ?? null,
                        confidence: finding.confidence ?? null,
                        fingerprint: finding.fingerprint ?? null,
                      }}
                    />
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ── Error from review stage ────────────────────────────────── */}
        {progress.stage === "error" && !result && error && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
              <span className="text-red-400 text-lg">{"\u2717"}</span>
            </div>
            <div className="text-center">
              <p className="text-[14px] font-medium text-red-400">Review Failed</p>
              <p className="text-[12px] text-slate-500 mt-1 max-w-md">{error}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="h-auto px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-200"
            >
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
