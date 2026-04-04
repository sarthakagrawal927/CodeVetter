import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ScoreBadge from "@/components/score-badge";
import { cn } from "@/lib/utils";
import {
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Zap,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import {
  isTauriAvailable,
  pickDirectory,
  listGitBranches,
  listPullRequests,
  getPreference,
  setPreference,
  runCliReview,
} from "@/lib/tauri-ipc";
import type { PullRequest, CliReviewResult, CliReviewFinding } from "@/lib/tauri-ipc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    case "critical":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    case "high":
      return "text-orange-400 bg-orange-500/10 border-orange-500/20";
    case "medium":
      return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
    case "warning":
      return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
    case "low":
      return "text-blue-400 bg-blue-500/10 border-blue-500/20";
    case "suggestion":
      return "text-cyan-400 bg-cyan-500/10 border-cyan-500/20";
    case "info":
      return "text-slate-400 bg-slate-500/10 border-slate-500/20";
    default:
      return "text-slate-400 bg-slate-500/10 border-slate-500/20";
  }
}

function severityIcon(s: string) {
  switch (s) {
    case "critical":
    case "high":
      return <AlertTriangle size={14} className="text-red-400" />;
    case "medium":
    case "warning":
      return <AlertTriangle size={14} className="text-yellow-400" />;
    default:
      return <CheckCircle size={14} className="text-slate-400" />;
  }
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QuickReview() {
  const [repoPath, setRepoPath] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [activeTab, setActiveTab] = useState<"branches" | "prs">("branches");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [projectDesc, setProjectDesc] = useState("");
  const [changeDesc, setChangeDesc] = useState("");
  const [isReviewing, setIsReviewing] = useState(false);
  const [result, setResult] = useState<CliReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Diff range derived from selection
  const [diffRange, setDiffRange] = useState("");

  // ─── Folder picker ───────────────────────────────────────────────────────

  const handlePickFolder = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Not running in Tauri");
      return;
    }
    try {
      const dir = await pickDirectory("Select a git repository");
      if (!dir) return;

      setRepoPath(dir);
      setResult(null);
      setError(null);
      setSelectedBranch("");
      setDiffRange("");

      // Load branches + PRs in parallel
      const [branchResult, prs] = await Promise.allSettled([
        listGitBranches(dir),
        listPullRequests(dir),
      ]);

      if (branchResult.status === "fulfilled") {
        const { branches: brList, current } = branchResult.value;
        setBranches(brList);
        setCurrentBranch(current ?? "");

        // Auto-detect base branch
        if (brList.includes("main")) setBaseBranch("main");
        else if (brList.includes("master")) setBaseBranch("master");
        else if (brList.length > 0) setBaseBranch(brList[0]);
      } else {
        setBranches([]);
        setCurrentBranch("");
      }

      if (prs.status === "fulfilled") {
        setPullRequests(prs.value);
      } else {
        setPullRequests([]);
      }

      // Load persisted project description
      const prefKey = `quick_review_desc_${btoa(dir)}`;
      try {
        const saved = await getPreference(prefKey);
        if (saved != null) setProjectDesc(saved);
        else setProjectDesc("");
      } catch {
        setProjectDesc("");
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("TAURI_NOT_AVAILABLE")) {
        setError("Not running in Tauri");
      } else {
        setError(msg);
      }
    }
  }, []);

  // ─── Branch/PR selection ─────────────────────────────────────────────────

  const handleSelectBranch = useCallback(
    (branch: string) => {
      setSelectedBranch(branch);
      setDiffRange(`${baseBranch}...${branch}`);
      setResult(null);
      setError(null);
    },
    [baseBranch],
  );

  const handleSelectPR = useCallback((pr: PullRequest) => {
    setSelectedBranch(pr.headRefName);
    setDiffRange(`${pr.baseRefName}...${pr.headRefName}`);
    setResult(null);
    setError(null);
  }, []);

  // ─── Persist project description on blur ─────────────────────────────────

  const handleProjectDescBlur = useCallback(() => {
    if (!repoPath || !isTauriAvailable()) return;
    const prefKey = `quick_review_desc_${btoa(repoPath)}`;
    setPreference(prefKey, projectDesc).catch(() => {});
  }, [repoPath, projectDesc]);

  // ─── Run review ──────────────────────────────────────────────────────────

  const handleReview = useCallback(async () => {
    if (!repoPath || !diffRange) return;

    setIsReviewing(true);
    setError(null);
    setResult(null);

    try {
      const res = await runCliReview(
        repoPath,
        diffRange,
        projectDesc,
        changeDesc,
        "claude",
      );
      setResult(res);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("TAURI_NOT_AVAILABLE")) {
        setError("Not running in Tauri");
      } else {
        setError(msg);
      }
    } finally {
      setIsReviewing(false);
    }
  }, [repoPath, diffRange, projectDesc, changeDesc]);

  // ─── Sorted findings ────────────────────────────────────────────────────

  const sortedFindings = result
    ? [...result.findings].sort(
        (a, b) =>
          (severityOrder[a.severity] ?? 99) -
          (severityOrder[b.severity] ?? 99),
      )
    : [];

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-[#1e2231]">
        {/* Header */}
        <div className="shrink-0 border-b border-[#1e2231] px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-amber-400" />
            <h1 className="text-sm font-semibold text-slate-200">
              Quick Review
            </h1>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Folder picker */}
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-[#1e2231] bg-[#13151c] text-slate-300 hover:bg-[#1a1d27] hover:text-slate-100"
            onClick={handlePickFolder}
          >
            <FolderOpen size={16} />
            {repoPath ? shortenPath(repoPath) : "Select repository..."}
          </Button>

          {/* Branch/PR tabs + list */}
          {repoPath && (
            <>
              {/* Tabs */}
              <div className="flex gap-1 rounded-lg bg-[#13151c] p-1">
                <button
                  onClick={() => setActiveTab("branches")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    activeTab === "branches"
                      ? "bg-[#1e2231] text-slate-100"
                      : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  <GitBranch size={14} />
                  Branches
                </button>
                <button
                  onClick={() => setActiveTab("prs")}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    activeTab === "prs"
                      ? "bg-[#1e2231] text-slate-100"
                      : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  <GitPullRequest size={14} />
                  PRs
                  {pullRequests.length > 0 && (
                    <span className="ml-1 text-[10px] text-slate-500">
                      {pullRequests.length}
                    </span>
                  )}
                </button>
              </div>

              {/* List */}
              <div className="max-h-[200px] overflow-y-auto rounded-lg border border-[#1e2231] bg-[#13151c]">
                {activeTab === "branches" ? (
                  branches.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-slate-500">
                      No branches found
                    </div>
                  ) : (
                    branches.map((branch) => (
                      <button
                        key={branch}
                        onClick={() => handleSelectBranch(branch)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                          selectedBranch === branch
                            ? "bg-amber-500/10 text-amber-400"
                            : "text-slate-400 hover:bg-[#1a1d27] hover:text-slate-200",
                        )}
                      >
                        <GitBranch size={12} className="shrink-0" />
                        <span className="truncate">{branch}</span>
                        {branch === currentBranch && (
                          <Badge
                            variant="outline"
                            className="ml-auto shrink-0 border-emerald-500/30 text-[9px] text-emerald-400"
                          >
                            current
                          </Badge>
                        )}
                      </button>
                    ))
                  )
                ) : pullRequests.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-500">
                    No open PRs
                  </div>
                ) : (
                  pullRequests.map((pr) => (
                    <button
                      key={pr.number}
                      onClick={() => handleSelectPR(pr)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        selectedBranch === pr.headRefName
                          ? "bg-amber-500/10 text-amber-400"
                          : "text-slate-400 hover:bg-[#1a1d27] hover:text-slate-200",
                      )}
                    >
                      <GitPullRequest size={12} className="shrink-0" />
                      <span className="shrink-0 text-slate-500">
                        #{pr.number}
                      </span>
                      <span className="truncate">{pr.title}</span>
                    </button>
                  ))
                )}
              </div>

              {/* Diff range indicator */}
              {diffRange && (
                <div className="rounded-md bg-[#13151c] px-3 py-2 font-mono text-[11px] text-slate-500">
                  {diffRange}
                </div>
              )}

              <Separator className="bg-[#1e2231]" />

              {/* Project description */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">
                  Project description
                </label>
                <textarea
                  value={projectDesc}
                  onChange={(e) => setProjectDesc(e.target.value)}
                  onBlur={handleProjectDescBlur}
                  placeholder="Describe the project so the reviewer has context..."
                  className="w-full resize-none rounded-md border border-[#1e2231] bg-[#13151c] px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-amber-500/40 focus:outline-none"
                  rows={3}
                />
              </div>

              {/* Change description */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-400">
                  Change description
                </label>
                <textarea
                  value={changeDesc}
                  onChange={(e) => setChangeDesc(e.target.value)}
                  placeholder="What does this change do?"
                  className="w-full resize-none rounded-md border border-[#1e2231] bg-[#13151c] px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-amber-500/40 focus:outline-none"
                  rows={2}
                />
              </div>

              {/* Review button */}
              <Button
                onClick={handleReview}
                disabled={!diffRange || isReviewing}
                className="w-full gap-2 bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {isReviewing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Zap size={16} />
                )}
                {isReviewing ? "Reviewing..." : "Review with Claude"}
              </Button>

              {/* Error */}
              {error && (
                <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto">
        {isReviewing ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Loader2 size={32} className="animate-spin text-amber-400" />
            <span className="text-sm text-slate-400">
              Reviewing with Claude...
            </span>
          </div>
        ) : result ? (
          <div className="max-w-3xl p-6">
            {/* Score + summary header */}
            <div className="flex items-start gap-4">
              <ScoreBadge score={Math.round(result.score)} size="lg" />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-slate-200">
                  Review Results
                </h2>
                {result.summary && (
                  <p className="mt-1 text-sm text-slate-400">
                    {result.summary}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                  <Badge variant="outline" className="text-[10px]">
                    {sortedFindings.length} finding
                    {sortedFindings.length !== 1 ? "s" : ""}
                  </Badge>
                  <span className="font-mono">{diffRange}</span>
                </div>
              </div>
            </div>

            <Separator className="my-5 bg-[#1e2231]" />

            {/* Findings list */}
            {sortedFindings.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 px-4 py-6 text-sm text-emerald-400">
                <CheckCircle size={18} />
                No findings — clean review.
              </div>
            ) : (
              <div className="space-y-3">
                {sortedFindings.map((finding, idx) => (
                  <FindingItem key={idx} finding={finding} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
            <GitBranch size={32} className="text-slate-600" />
            <span className="text-sm">
              Select a branch and run a review
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FindingItem ──────────────────────────────────────────────────────────────

function FindingItem({ finding }: { finding: CliReviewFinding }) {
  return (
    <div className="rounded-lg border border-[#1e2231] bg-[#13151c] p-4">
      {/* Header: severity badge + title */}
      <div className="flex items-start gap-2">
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px] font-semibold uppercase",
            severityColor(finding.severity),
          )}
        >
          {finding.severity}
        </Badge>
        <h3 className="text-sm font-medium text-slate-200">{finding.title}</h3>
      </div>

      {/* Summary */}
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {finding.summary}
      </p>

      {/* File + line */}
      {finding.filePath && (
        <div className="mt-2 flex items-center gap-1 font-mono text-[11px] text-slate-500">
          <span className="truncate">{finding.filePath}</span>
          {finding.line != null && <span>:{finding.line}</span>}
        </div>
      )}

      {/* Suggestion */}
      {finding.suggestion && (
        <div className="mt-3 rounded-md bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-xs text-amber-300/80">
          <span className="font-semibold text-amber-400">Suggestion: </span>
          {finding.suggestion}
        </div>
      )}

      {/* Confidence */}
      {finding.confidence != null && (
        <div className="mt-2 text-[10px] text-slate-600">
          Confidence: {Math.round(finding.confidence * 100)}%
        </div>
      )}
    </div>
  );
}
