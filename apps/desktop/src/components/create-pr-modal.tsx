import { useState, useEffect } from "react";
import {
  createPullRequest,
  listGitBranches,
  updateWorkspace,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow } from "@/lib/tauri-ipc";

interface CreatePrModalProps {
  workspace: WorkspaceRow;
  onClose: () => void;
  onCreated: (prNumber: number, prUrl: string) => void;
}

export default function CreatePrModal({
  workspace,
  onClose,
  onCreated,
}: CreatePrModalProps) {
  const [title, setTitle] = useState(workspace.name);
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load branches for the base branch selector
  useEffect(() => {
    if (!isTauriAvailable()) return;
    listGitBranches(workspace.repo_path)
      .then((result) => {
        setBranches(result.branches);
        // If "main" isn't a branch, try "master", otherwise use whatever's first
        if (!result.branches.includes("main")) {
          if (result.branches.includes("master")) {
            setBaseBranch("master");
          } else if (result.branches.length > 0) {
            setBaseBranch(result.branches[0]);
          }
        }
      })
      .catch(() => {
        // Fallback: just keep "main"
      });
  }, [workspace.repo_path]);

  async function handleCreate() {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const result = await createPullRequest(
        workspace.repo_path,
        title.trim(),
        body.trim(),
        baseBranch,
        workspace.branch
      );

      // Update workspace with PR info
      try {
        await updateWorkspace({
          id: workspace.id,
          prNumber: result.number,
          prUrl: result.url,
          status: "in_review",
        });
      } catch {
        // Non-critical if workspace update fails
      }

      onCreated(result.number, result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-[13px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-[#1e2231] bg-[#13151c] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200">
            Create Pull Request
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-sm"
          >
            {"\u2715"}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="PR title"
              className={inputClass}
              autoFocus
            />
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Description{" "}
              <span className="text-slate-600 font-normal">(markdown)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your changes..."
              className={`${inputClass} min-h-[100px] resize-y`}
              rows={5}
            />
          </div>

          {/* Base branch */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Base Branch
            </label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              {branches.length > 0 ? (
                branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))
              ) : (
                <option value={baseBranch}>{baseBranch}</option>
              )}
            </select>
          </div>

          {/* Head branch (read-only) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Head Branch{" "}
              <span className="text-slate-600 font-normal">(from workspace)</span>
            </label>
            <input
              type="text"
              value={workspace.branch}
              readOnly
              className={`${inputClass} opacity-60 cursor-not-allowed`}
            />
          </div>

          {/* Branch direction label */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1">
            <span className="font-mono text-amber-400/70">{workspace.branch}</span>
            <svg className="h-3 w-3 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-mono text-slate-400">{baseBranch}</span>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="text-[12px] text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handleCreate}
              disabled={!title.trim() || loading}
              className="rounded-lg bg-amber-500 px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border border-black/30 border-t-black" />
                  Creating...
                </span>
              ) : (
                "Create PR"
              )}
            </button>
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded-lg px-4 py-2 text-[12px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
