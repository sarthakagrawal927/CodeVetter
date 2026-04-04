import { useState, useEffect } from "react";
import {
  isTauriAvailable,
  openInApp,
  getGitRemoteInfo,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow } from "@/lib/tauri-ipc";
import { Button } from "@/components/ui/button";

function repoName(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() || repoPath;
}

// ─── Top Bar (breadcrumb + actions) ─────────────────────────────────────

export default function WorkspaceTopBar({
  workspace,
  onShowCreatePr,
  onShowPrReview,
}: {
  workspace: WorkspaceRow;
  onShowCreatePr: () => void;
  onShowPrReview: () => void;
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
    <div className="flex items-center justify-between border-b border-[#1a1a1a] bg-[#0e0f13] px-4 py-2 shrink-0">
      <div className="flex items-center gap-1 text-[12px] min-w-0 overflow-hidden">
        <span className="text-slate-500 shrink-0">&#128193;</span>
        <span className="text-slate-400 truncate">{repoDisplay}</span>
        <span className="text-slate-600 mx-1 shrink-0">{">"}</span>
        <span className="text-slate-200 font-medium truncate">{workspace.branch}</span>
        <span className="text-slate-600 mx-1 shrink-0">{">"}</span>
        <span className="text-slate-400 font-mono truncate">/{folderName}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Review PR button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onShowPrReview}
          className="h-auto px-2.5 py-1 text-[11px] font-medium border-[#1a1a1a] bg-[#0f1117] text-slate-400 hover:text-slate-200"
        >
          Review PR
        </Button>

        {/* Open dropdown */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpenMenuVisible(!openMenuVisible)}
            className="h-auto px-2.5 py-1 text-[11px] border-[#1a1a1a] bg-[#0f1117] text-slate-400 hover:text-slate-200"
          >
            Open &#9662;
          </Button>
          {openMenuVisible && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setOpenMenuVisible(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-[#1a1a1a] bg-[#0a0a0a] shadow-xl py-1">
                <button
                  onClick={() => handleOpenIn("cursor")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#111111] transition-colors"
                >
                  Open in Cursor
                </button>
                <button
                  onClick={() => handleOpenIn("vscode")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#111111] transition-colors"
                >
                  Open in VS Code
                </button>
                <button
                  onClick={() => handleOpenIn("finder")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#111111] transition-colors"
                >
                  Open in Finder
                </button>
                <button
                  onClick={() => handleOpenIn("terminal")}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-[#111111] transition-colors"
                >
                  Open in Terminal
                </button>
              </div>
            </>
          )}
        </div>
        {/* Create PR button */}
        {!workspace.pr_number && (
          <Button
            size="sm"
            onClick={onShowCreatePr}
            className="h-auto px-2.5 py-1 text-[11px] font-semibold bg-amber-500 text-white hover:bg-amber-600"
          >
            Create PR
          </Button>
        )}
        {workspace.pr_number && workspace.pr_url && (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="h-auto px-2.5 py-1 text-[11px] font-medium text-amber-400 bg-amber-500/15 border-amber-500/20 hover:bg-amber-500/25 hover:text-amber-400"
          >
            <a
              href={workspace.pr_url}
              target="_blank"
              rel="noreferrer"
            >
              PR #{workspace.pr_number}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
