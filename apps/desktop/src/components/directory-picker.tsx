import { useEffect } from "react";
import {
  pickDirectory,
  listGitBranches,
  getGitRemoteInfo,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { GitRemoteInfo } from "@/lib/tauri-ipc";

interface DirectoryPickerProps {
  value: string;
  onChange: (path: string) => void;
  label?: string;
  placeholder?: string;
  /** When set, also detects git info and calls back with branches/remote */
  onGitDetected?: (info: {
    branches: string[];
    currentBranch: string | null;
    remote: GitRemoteInfo | null;
  }) => void;
}

const inputClass =
  "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

export default function DirectoryPicker({
  value,
  onChange,
  label,
  placeholder = "/Users/you/projects/your-repo",
  onGitDetected,
}: DirectoryPickerProps) {
  async function handleBrowse() {
    const selected = await pickDirectory(label ?? "Select Directory");
    if (selected) {
      onChange(selected);
    }
  }

  // When value changes, detect git info
  useEffect(() => {
    const callback = onGitDetected;
    if (!value || !callback || !isTauriAvailable()) return;

    let cancelled = false;

    async function detect() {
      try {
        const [branchResult, remoteResult] = await Promise.allSettled([
          listGitBranches(value),
          getGitRemoteInfo(value),
        ]);

        if (cancelled) return;

        const branches =
          branchResult.status === "fulfilled"
            ? branchResult.value.branches
            : [];
        const currentBranch =
          branchResult.status === "fulfilled"
            ? branchResult.value.current
            : null;
        const remote =
          remoteResult.status === "fulfilled" ? remoteResult.value : null;

        callback!({ branches, currentBranch, remote });
      } catch {
        // Not a git repo or git not available
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-medium text-slate-300">{label}</label>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`mono flex-1 ${inputClass}`}
        />
        {isTauriAvailable() && (
          <button
            type="button"
            onClick={handleBrowse}
            className="shrink-0 rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-400 transition-colors hover:border-[#2d3348] hover:text-slate-200"
            title="Browse..."
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Branch Selector ─────────────────────────────────────────────────────────

interface BranchSelectorProps {
  branches: string[];
  currentBranch: string | null;
  value: string;
  onChange: (branch: string) => void;
  label?: string;
}

export function BranchSelector({
  branches,
  currentBranch,
  value,
  onChange,
  label = "Branch",
}: BranchSelectorProps) {
  if (branches.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-300">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 outline-none focus:border-amber-500/50 appearance-none"
      >
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
            {b === currentBranch ? " (current)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
