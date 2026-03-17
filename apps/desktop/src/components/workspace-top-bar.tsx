import { useState, useEffect } from "react";
import {
  isTauriAvailable,
  openInApp,
  getGitRemoteInfo,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow } from "@/lib/tauri-ipc";

function repoName(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() || repoPath;
}

// ─── Top Bar (breadcrumb + actions) ─────────────────────────────────────

export default function WorkspaceTopBar({
  workspace,
  onShowCreatePr,
}: {
  workspace: WorkspaceRow;
  onShowCreatePr: () => void;
}) {
  const [remoteInfo, setRemoteInfo] = useState<{
    owner: string;
    repo: string;
  } | null>(null);
  const [openMenuVisible, setOpenMenuVisible] = useState(false);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    getGitRemoteInfo(workspace.repo_path)
      .then((info) => setRemoteInfo({ owner: info.owner, repo: info.repo }))
      .catch(() => setRemoteInfo(null));
  }, [workspace.repo_path]);

  const repoDisplay = remoteInfo
    ? `${remoteInfo.owner}/${remoteInfo.repo}`
    : repoName(workspace.repo_path);

  const folderName =
    workspace.repo_path.split("/").filter(Boolean).pop() ?? "";

  function handleOpenIn(app: string) {
    setOpenMenuVisible(false);
    openInApp(app, workspace.repo_path).catch((err) =>
      console.error("Failed to open:", err)
    );
  }

  return (
    <div className="flex items-center justify-between border-b border-[#1e2231] bg-[#0e0f13] px-4 py-2 shrink-0">
      <div className="flex items-center gap-1 text-[12px] min-w-0">
        <span className="text-slate-500">&#128193;</span>
        <span className="text-slate-400 truncate">{repoDisplay}</span>
        <span className="text-slate-600 mx-1">{">"}</span>
        <span className="text-slate-200 font-medium">{workspace.branch}</span>
        <span className="text-slate-600 mx-1">{">"}</span>
        <span className="text-slate-400 font-mono">/{folderName}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Open dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenMenuVisible(!openMenuVisible)}
            className="rounded border border-[#1e2231] bg-[#0f1117] px-2.5 py-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
          >
            Open &#9662;
          </button>
          {openMenuVisible && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setOpenMenuVisible(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-[#1e2231] bg-[#13151c] shadow-xl py-1">
                <button
                  onClick={() => handleOpenIn("cursor")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#1a1d27] transition-colors"
                >
                  Open in Cursor
                </button>
                <button
                  onClick={() => handleOpenIn("vscode")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#1a1d27] transition-colors"
                >
                  Open in VS Code
                </button>
                <button
                  onClick={() => handleOpenIn("finder")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#1a1d27] transition-colors"
                >
                  Open in Finder
                </button>
                <button
                  onClick={() => handleOpenIn("terminal")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#1a1d27] transition-colors"
                >
                  Open in Terminal
                </button>
              </div>
            </>
          )}
        </div>
        {/* Create PR button */}
        {!workspace.pr_number && (
          <button
            onClick={onShowCreatePr}
            className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-600 transition-colors"
          >
            Create PR
          </button>
        )}
        {workspace.pr_number && workspace.pr_url && (
          <a
            href={workspace.pr_url}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-amber-500/25 transition-colors"
          >
            PR #{workspace.pr_number}
          </a>
        )}
      </div>
    </div>
  );
}
