import { useState, useEffect } from "react";
import { pickDirectory } from "@/lib/tauri-ipc";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Create Workspace Modal ─────────────────────────────────────────────────

export default function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (
    name: string,
    repoPath: string,
    branch: string,
    prNumber?: number
  ) => void;
}) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [branch, setBranch] = useState("");
  const [prNumber, setPrNumber] = useState("");

  useEffect(() => {
    if (name.trim()) {
      setBranch(`workspace/${slugify(name)}`);
    }
  }, [name]);

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-[13px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#1e2231] bg-[#13151c] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200">
            New Workspace
          </h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-sm"
          >
            {"\u2715"}
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Add workspace system"
              className={inputClass}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Project Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/path/to/project"
                className={`flex-1 ${inputClass}`}
              />
              <button
                onClick={async () => {
                  const dir = await pickDirectory("Select project directory");
                  if (dir) setRepoPath(dir);
                }}
                className="shrink-0 rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-[12px] text-slate-400 hover:text-slate-200 transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Branch
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="workspace/feature-name"
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              PR Number{" "}
              <span className="text-slate-600 font-normal">(optional)</span>
            </label>
            <input
              type="number"
              value={prNumber}
              onChange={(e) => setPrNumber(e.target.value)}
              placeholder="e.g. 42"
              className={inputClass}
            />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => {
                if (name.trim() && repoPath.trim() && branch.trim()) {
                  onCreate(
                    name.trim(),
                    repoPath.trim(),
                    branch.trim(),
                    prNumber ? parseInt(prNumber) : undefined
                  );
                }
              }}
              disabled={!name.trim() || !repoPath.trim() || !branch.trim()}
              className="rounded-lg bg-amber-500 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              Create Workspace
            </button>
            <button
              onClick={onClose}
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
