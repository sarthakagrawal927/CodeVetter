import { useState, useEffect } from "react";
import type { ReviewTone, GitRemoteInfo, PullRequest } from "@/lib/tauri-ipc";
import { listPullRequests, isTauriAvailable } from "@/lib/tauri-ipc";
import DirectoryPicker, { BranchSelector } from "./directory-picker";

interface ReviewFormProps {
  onSubmitLocal: (repoPath: string, diffRange: string, tone: ReviewTone) => void;
  onSubmitPr: (owner: string, repo: string, prNumber: number, tone: ReviewTone) => void;
  isLoading?: boolean;
}

type ReviewMode = "local" | "pr";

const tones: { value: ReviewTone; label: string; desc: string }[] = [
  { value: "concise", label: "Concise", desc: "Quick summary of key issues" },
  { value: "thorough", label: "Thorough", desc: "Detailed analysis of all findings" },
  { value: "mentoring", label: "Mentoring", desc: "Educational with explanations" },
  { value: "strict", label: "Strict", desc: "Rigorous, production-grade standards" },
];

export default function ReviewForm({
  onSubmitLocal,
  onSubmitPr,
  isLoading = false,
}: ReviewFormProps) {
  const [mode, setMode] = useState<ReviewMode>("local");
  const [repoPath, setRepoPath] = useState("");
  const [tone, setTone] = useState<ReviewTone>("thorough");

  // Local diff state
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [diffFrom, setDiffFrom] = useState("");
  const [diffTo, setDiffTo] = useState("");

  // PR state (auto-detected from repo)
  const [remote, setRemote] = useState<GitRemoteInfo | null>(null);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const [loadingPrs, setLoadingPrs] = useState(false);

  // Manual PR entry fallback
  const [manualOwner, setManualOwner] = useState("");
  const [manualRepo, setManualRepo] = useState("");
  const [manualPrNumber, setManualPrNumber] = useState("");

  function handleGitDetected(info: {
    branches: string[];
    currentBranch: string | null;
    remote: GitRemoteInfo | null;
  }) {
    setBranches(info.branches);
    setCurrentBranch(info.currentBranch);
    setRemote(info.remote);

    if (info.remote) {
      setManualOwner(info.remote.owner);
      setManualRepo(info.remote.repo);
    }

    // Default diff range: compare current branch to HEAD~1
    if (info.currentBranch && !diffTo) {
      setDiffTo(info.currentBranch);
    }
  }

  // Fetch PRs when switching to PR mode with a valid repo path
  useEffect(() => {
    if (mode !== "pr" || !repoPath || !isTauriAvailable()) return;

    let cancelled = false;
    setLoadingPrs(true);

    listPullRequests(repoPath)
      .then((prs) => {
        if (!cancelled) {
          setPullRequests(prs);
          if (prs.length > 0 && selectedPr === null) {
            setSelectedPr(prs[0].number);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setPullRequests([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPrs(false);
      });

    return () => { cancelled = true; };
  }, [mode, repoPath]);

  function getDiffRange(): string {
    if (diffFrom && diffTo) return `${diffFrom}..${diffTo}`;
    if (diffFrom) return `${diffFrom}..HEAD`;
    if (diffTo) return `HEAD~1..${diffTo}`;
    return "HEAD~1..HEAD";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "local") {
      onSubmitLocal(repoPath, getDiffRange(), tone);
    } else {
      const owner = remote?.owner || manualOwner;
      const repo = remote?.repo || manualRepo;
      const prNum = selectedPr ?? parseInt(manualPrNumber, 10);
      if (owner && repo && prNum) {
        onSubmitPr(owner, repo, prNum, tone);
      }
    }
  }

  const canSubmitLocal = repoPath.trim().length > 0;
  const canSubmitPr =
    (remote?.owner || manualOwner) &&
    (remote?.repo || manualRepo) &&
    (selectedPr || parseInt(manualPrNumber, 10) > 0);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-lg border border-[#1e2231] bg-[#0f1117] p-1 self-start">
        <button
          type="button"
          onClick={() => setMode("local")}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
            mode === "local"
              ? "bg-amber-500/20 text-amber-400"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Local Diff
        </button>
        <button
          type="button"
          onClick={() => setMode("pr")}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
            mode === "pr"
              ? "bg-amber-500/20 text-amber-400"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Pull Request
        </button>
      </div>

      {/* Repository path — shared between both modes */}
      <DirectoryPicker
        value={repoPath}
        onChange={setRepoPath}
        label="Repository"
        onGitDetected={handleGitDetected}
      />

      {/* Git repo indicator */}
      {repoPath && branches.length > 0 && (
        <div className="flex items-center gap-2 -mt-3">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-[11px] text-slate-500">
            Git repo detected{currentBranch ? ` \u2014 on ${currentBranch}` : ""}
            {remote ? ` \u2014 ${remote.owner}/${remote.repo}` : ""}
          </span>
        </div>
      )}

      {mode === "local" ? (
        <>
          {/* Branch-based diff range */}
          {branches.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              <BranchSelector
                branches={["HEAD~1", "HEAD~3", "HEAD~5", "main", "master", ...branches]}
                currentBranch={null}
                value={diffFrom || "HEAD~1"}
                onChange={setDiffFrom}
                label="Compare from"
              />
              <BranchSelector
                branches={branches}
                currentBranch={currentBranch}
                value={diffTo || currentBranch || ""}
                onChange={setDiffTo}
                label="Compare to"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">
                Diff Range
              </label>
              <input
                type="text"
                value={diffFrom && diffTo ? `${diffFrom}..${diffTo}` : "HEAD~1..HEAD"}
                onChange={(e) => {
                  const [from, to] = e.target.value.split("..");
                  setDiffFrom(from || "");
                  setDiffTo(to || "");
                }}
                placeholder="HEAD~1..HEAD"
                className="mono rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
              />
              <p className="text-[11px] text-slate-500">
                Git diff range, e.g. main..feature-branch or HEAD~3..HEAD
              </p>
            </div>
          )}

          {/* Tone */}
          <ToneSelector tone={tone} setTone={setTone} />
        </>
      ) : (
        <>
          {/* Pull Request selection */}
          {pullRequests.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-300">
                Pull Request
              </label>
              <select
                value={selectedPr ?? ""}
                onChange={(e) => setSelectedPr(parseInt(e.target.value, 10))}
                className="rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500/50 appearance-none"
              >
                {pullRequests.map((pr) => (
                  <option key={pr.number} value={pr.number}>
                    #{pr.number} \u2014 {pr.title}
                    {pr.author ? ` (${pr.author.login})` : ""}
                  </option>
                ))}
              </select>
              {selectedPr && (
                <p className="text-[11px] text-slate-500">
                  {pullRequests.find((p) => p.number === selectedPr)?.headRefName}
                </p>
              )}
            </div>
          ) : loadingPrs ? (
            <p className="text-xs text-slate-500">Loading pull requests...</p>
          ) : (
            <>
              {/* Manual entry fallback */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Owner</label>
                  <input
                    type="text"
                    value={manualOwner}
                    onChange={(e) => setManualOwner(e.target.value)}
                    placeholder="octocat"
                    className="mono rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-slate-300">Repository</label>
                  <input
                    type="text"
                    value={manualRepo}
                    onChange={(e) => setManualRepo(e.target.value)}
                    placeholder="my-project"
                    className="mono rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-300">PR Number</label>
                <input
                  type="number"
                  value={manualPrNumber}
                  onChange={(e) => setManualPrNumber(e.target.value)}
                  placeholder="42"
                  min={1}
                  className="mono w-32 rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition-colors focus:border-amber-500/50"
                />
              </div>
            </>
          )}

          {/* Tone */}
          <ToneSelector tone={tone} setTone={setTone} />
        </>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading || (mode === "local" ? !canSubmitLocal : !canSubmitPr)}
        className="mt-2 self-start rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Analyzing..." : "Start Review"}
      </button>
    </form>
  );
}

// ─── Tone Selector (extracted for reuse) ─────────────────────────────────────

function ToneSelector({
  tone,
  setTone,
}: {
  tone: ReviewTone;
  setTone: (t: ReviewTone) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-slate-300">Review Tone</label>
      <div className="grid grid-cols-2 gap-2">
        {tones.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTone(t.value)}
            className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-all ${
              tone === t.value
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-[#1e2231] bg-[#0f1117] hover:border-[#2d3348]"
            }`}
          >
            <span
              className={`text-xs font-medium ${
                tone === t.value ? "text-amber-400" : "text-slate-300"
              }`}
            >
              {t.label}
            </span>
            <span className="text-[11px] text-slate-500">{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
