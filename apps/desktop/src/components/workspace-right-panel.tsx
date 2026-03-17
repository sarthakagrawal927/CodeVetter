import { useState, useEffect, useCallback, useMemo } from "react";
import {
  isTauriAvailable,
  getWorkspaceGitStatus,
  listDirectoryTree,
  readFilePreview,
  getGitChangedFiles,
  listCiChecks,
  getFileDiff,
  listDiffComments,
  createDiffComment,
  deleteDiffComment,
} from "@/lib/tauri-ipc";
import type {
  WorkspaceRow,
  FileEntry,
  FilePreview,
  CICheck,
  GitChangedFile,
  DiffComment,
} from "@/lib/tauri-ipc";
import DiffViewer from "@/components/diff-viewer";
import PrStatusPanel from "@/components/pr-status-panel";
import TerminalPanel from "@/components/terminal-panel";

// ─── File icon by extension ──────────────────────────────────────────────

function fileIcon(name: string, isDir: boolean): { icon: string; color: string } {
  if (isDir) return { icon: "\u25B8", color: "text-slate-400" };
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return { icon: "\u25CF", color: "text-blue-400" };
    case "js":
    case "jsx":
    case "mjs":
      return { icon: "\u25CF", color: "text-yellow-400" };
    case "rs":
      return { icon: "\u25CF", color: "text-orange-400" };
    case "py":
      return { icon: "\u25CF", color: "text-green-400" };
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return { icon: "\u25CF", color: "text-slate-500" };
    case "md":
    case "mdx":
      return { icon: "\u25CF", color: "text-slate-400" };
    case "css":
    case "scss":
      return { icon: "\u25CF", color: "text-pink-400" };
    case "html":
      return { icon: "\u25CF", color: "text-red-400" };
    default:
      return { icon: "\u25CF", color: "text-slate-600" };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── File Tree Tab ──────────────────────────────────────────────────────

function FileTreePanel({ workspace }: { workspace: WorkspaceRow }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!isTauriAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listDirectoryTree(workspace.repo_path)
      .then((result) => setEntries(result.entries))
      .catch((err) => console.error("Failed to load file tree:", err))
      .finally(() => setLoading(false));
  }, [workspace.repo_path, workspace.id]);

  function toggleDir(path: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function handleFileClick(entry: FileEntry) {
    if (entry.is_dir) {
      toggleDir(entry.path);
      return;
    }
    const fullPath = `${workspace.repo_path}/${entry.path}`;
    setPreviewFile(entry.path);
    setPreviewLoading(true);
    setPreview(null);
    readFilePreview(fullPath, 100)
      .then((result) => setPreview(result))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }

  // Filter visible entries based on collapsed directories
  const visibleEntries = useMemo(() => {
    const result: FileEntry[] = [];
    const hiddenPrefixes: string[] = [];

    for (const entry of entries) {
      // Check if this entry is inside a collapsed directory
      const isHidden = hiddenPrefixes.some((prefix) =>
        entry.path.startsWith(prefix + "/")
      );
      if (isHidden) continue;

      result.push(entry);

      // If this is a collapsed directory, hide its children
      if (entry.is_dir && collapsedDirs.has(entry.path)) {
        hiddenPrefixes.push(entry.path);
      }
    }
    return result;
  }, [entries, collapsedDirs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <span className="ml-2 text-[11px] text-slate-500">Loading files...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* File preview modal */}
      {previewFile && (
        <div className="border-b border-[#1e2231] bg-[#0a0b0f]">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10px] text-slate-400 font-mono truncate">
              {previewFile}
            </span>
            <button
              onClick={() => {
                setPreviewFile(null);
                setPreview(null);
              }}
              className="text-slate-500 hover:text-slate-300 text-[11px] ml-2"
            >
              {"\u2715"}
            </button>
          </div>
          {previewLoading ? (
            <div className="px-3 py-4 text-[10px] text-slate-500">Loading...</div>
          ) : preview ? (
            <div className="max-h-48 overflow-y-auto px-3 pb-2">
              <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                {preview.content}
              </pre>
              {preview.total_lines > 100 && (
                <div className="text-[9px] text-slate-600 mt-1">
                  Showing first 100 of {preview.total_lines} lines ({preview.language})
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 text-[10px] text-slate-600">
              Unable to preview this file
            </div>
          )}
        </div>
      )}

      {/* Tree list */}
      <div className="flex-1 overflow-y-auto py-1">
        {visibleEntries.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-slate-600">
            No files found
          </div>
        ) : (
          visibleEntries.map((entry) => {
            const { icon, color } = fileIcon(entry.name, entry.is_dir);
            const isCollapsed = entry.is_dir && collapsedDirs.has(entry.path);
            const indent = entry.depth * 16;

            return (
              <button
                key={entry.path}
                onClick={() => handleFileClick(entry)}
                className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-[12px] hover:bg-[#1a1d27] transition-colors text-left ${
                  previewFile === entry.path
                    ? "bg-amber-500/5"
                    : ""
                }`}
                style={{ paddingLeft: `${8 + indent}px` }}
              >
                {entry.is_dir ? (
                  <span className="text-[10px] text-slate-500 w-3 text-center">
                    {isCollapsed ? "\u25B8" : "\u25BE"}
                  </span>
                ) : (
                  <span className={`text-[6px] ${color} w-3 text-center`}>
                    {icon}
                  </span>
                )}
                <span
                  className={
                    entry.is_dir ? "text-slate-300" : "text-slate-500"
                  }
                >
                  {entry.name}
                </span>
                {!entry.is_dir && entry.size_bytes !== null && (
                  <span className="ml-auto text-[9px] text-slate-700 shrink-0">
                    {formatBytes(entry.size_bytes)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Checks Tab ─────────────────────────────────────────────────────────

function ChecksPanel({ workspace }: { workspace: WorkspaceRow }) {
  const [gitStatus, setGitStatus] = useState<{
    changed_files: number;
  } | null>(null);
  const [ciChecks, setCiChecks] = useState<CICheck[]>([]);
  const [loadingGit, setLoadingGit] = useState(true);
  const [loadingCi, setLoadingCi] = useState(false);

  useEffect(() => {
    if (!isTauriAvailable()) {
      setLoadingGit(false);
      return;
    }
    setLoadingGit(true);
    getWorkspaceGitStatus(workspace.id)
      .then((result) => setGitStatus(result))
      .catch(() => setGitStatus(null))
      .finally(() => setLoadingGit(false));
  }, [workspace.id, workspace.updated_at]);

  useEffect(() => {
    if (!isTauriAvailable() || !workspace.pr_number) return;
    setLoadingCi(true);
    listCiChecks(workspace.repo_path, workspace.pr_number)
      .then((result) => setCiChecks(result.checks))
      .catch(() => setCiChecks([]))
      .finally(() => setLoadingCi(false));
  }, [workspace.repo_path, workspace.pr_number, workspace.updated_at]);

  const changedCount = gitStatus?.changed_files ?? 0;
  const gitClean = gitStatus !== null && changedCount === 0;

  function checkIcon(passed: boolean | null) {
    if (passed === null)
      return <span className="text-slate-500 text-[11px]">&#9711;</span>;
    if (passed)
      return <span className="text-emerald-400 text-[11px]">&#10003;</span>;
    return <span className="text-red-400 text-[11px]">&#10005;</span>;
  }

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Pre-merge Checklist
      </div>

      {/* Git status */}
      <div className="flex items-center gap-2 rounded-md border border-[#1e2231] px-3 py-2">
        {loadingGit ? (
          <div className="h-3 w-3 animate-spin rounded-full border border-amber-500 border-t-transparent" />
        ) : (
          checkIcon(gitClean)
        )}
        <div className="flex-1">
          <div className="text-[11px] text-slate-300">Git status</div>
          <div className="text-[10px] text-slate-500">
            {loadingGit
              ? "Checking..."
              : gitClean
              ? "Working tree clean"
              : `${changedCount} uncommitted change${changedCount !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      {/* CI checks */}
      {workspace.pr_number ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            CI Checks
          </div>
          {loadingCi ? (
            <div className="flex items-center gap-2 py-2">
              <div className="h-3 w-3 animate-spin rounded-full border border-amber-500 border-t-transparent" />
              <span className="text-[11px] text-slate-500">Loading checks...</span>
            </div>
          ) : ciChecks.length === 0 ? (
            <div className="rounded-md border border-[#1e2231] px-3 py-2">
              <span className="text-[11px] text-slate-500">
                No CI checks found
              </span>
            </div>
          ) : (
            ciChecks.map((check, i) => {
              const passed =
                check.conclusion === "success"
                  ? true
                  : check.conclusion === "failure" ||
                    check.conclusion === "cancelled"
                  ? false
                  : null;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-[#1e2231] px-3 py-1.5"
                >
                  {checkIcon(passed)}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-slate-300 truncate">
                      {check.name}
                    </div>
                  </div>
                  <span
                    className={`text-[9px] font-medium ${
                      passed === true
                        ? "text-emerald-400"
                        : passed === false
                        ? "text-red-400"
                        : "text-slate-500"
                    }`}
                  >
                    {check.conclusion ?? check.state}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="rounded-md border border-[#1e2231] px-3 py-2">
          <div className="flex items-center gap-2">
            {checkIcon(null)}
            <div>
              <div className="text-[11px] text-slate-300">CI checks</div>
              <div className="text-[10px] text-slate-500">
                No PR linked -- create a PR to see CI status
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Review readiness summary */}
      <div className="mt-1 pt-3 border-t border-[#1e2231]">
        <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-2">
          Summary
        </div>
        {(() => {
          const allCiPassed =
            ciChecks.length > 0 &&
            ciChecks.every((c) => c.conclusion === "success");
          const ready = gitClean && (allCiPassed || !workspace.pr_number);
          return (
            <div
              className={`rounded-md px-3 py-2 text-[11px] ${
                ready
                  ? "bg-emerald-500/5 border border-emerald-500/10 text-emerald-400"
                  : "bg-amber-500/5 border border-amber-500/10 text-amber-400"
              }`}
            >
              {ready
                ? "Ready to merge"
                : "Not ready -- resolve issues above"}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Changes Panel ──────────────────────────────────────────────────────

function ChangesPanel({ workspace }: { workspace: WorkspaceRow }) {
  const [files, setFiles] = useState<GitChangedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [comments, setComments] = useState<DiffComment[]>([]);

  // Load changed files
  useEffect(() => {
    if (!isTauriAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getGitChangedFiles(workspace.repo_path)
      .then((result) => setFiles(result.files))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [workspace.repo_path, workspace.updated_at]);

  // Load comments for this workspace
  useEffect(() => {
    if (!isTauriAvailable()) return;
    listDiffComments(workspace.id)
      .then(setComments)
      .catch(() => setComments([]));
  }, [workspace.id]);

  // Load diff when a file is selected
  useEffect(() => {
    if (!selectedFile || !isTauriAvailable()) {
      setDiffText("");
      return;
    }
    setDiffLoading(true);
    getFileDiff(workspace.repo_path, selectedFile)
      .then((result) => setDiffText(result.diff))
      .catch(() => setDiffText(""))
      .finally(() => setDiffLoading(false));
  }, [selectedFile, workspace.repo_path]);

  const handleCommentCreate = useCallback(
    async (startLine: number, endLine: number, content: string) => {
      if (!selectedFile || !isTauriAvailable()) return;
      try {
        const newComment = await createDiffComment({
          workspaceId: workspace.id,
          filePath: selectedFile,
          startLine,
          endLine,
          content,
        });
        setComments((prev) => [...prev, newComment]);
      } catch (err) {
        console.error("Failed to create comment:", err);
      }
    },
    [selectedFile, workspace.id]
  );

  const handleCommentDelete = useCallback(
    async (id: string) => {
      if (!isTauriAvailable()) return;
      try {
        await deleteDiffComment(id);
        setComments((prev) => prev.filter((c) => c.id !== id));
      } catch (err) {
        console.error("Failed to delete comment:", err);
      }
    },
    []
  );

  const statusStyle: Record<string, { color: string; label: string }> = {
    M: { color: "text-amber-400", label: "M" },
    A: { color: "text-emerald-400", label: "A" },
    D: { color: "text-red-400", label: "D" },
    R: { color: "text-blue-400", label: "R" },
    "?": { color: "text-slate-500", label: "?" },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        <span className="ml-2 text-[11px] text-slate-500">Checking changes...</span>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="p-3">
        <div className="rounded-md bg-emerald-500/5 border border-emerald-500/10 px-3 py-2">
          <span className="text-[11px] text-emerald-400">
            Clean -- no uncommitted changes
          </span>
        </div>
      </div>
    );
  }

  // Filter comments for selected file
  const fileComments = selectedFile
    ? comments.filter((c) => c.file_path === selectedFile)
    : [];

  return (
    <div className="flex flex-col h-full">
      {/* File list header */}
      <div className="px-3 py-2 border-b border-[#1e2231] shrink-0">
        {selectedFile ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedFile(null)}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              {"\u2190"} Back
            </button>
            <span className="text-[10px] font-medium text-slate-400 font-mono truncate">
              {selectedFile}
            </span>
            {fileComments.length > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[9px] font-semibold text-amber-400">
                {fileComments.length}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {files.length} changed file{files.length !== 1 ? "s" : ""} -- click to view diff
          </span>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          /* Diff viewer for selected file */
          diffLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <span className="ml-2 text-[11px] text-slate-500">Loading diff...</span>
            </div>
          ) : (
            <div className="p-2">
              <DiffViewer
                diff={diffText}
                filePath={selectedFile}
                workspaceId={workspace.id}
                comments={fileComments}
                onCommentCreate={handleCommentCreate}
                onCommentDelete={handleCommentDelete}
              />
            </div>
          )
        ) : (
          /* File list */
          <div className="py-1">
            {files.map((file, i) => {
              const st = statusStyle[file.status] ?? statusStyle["?"];
              const fileCommentCount = comments.filter(
                (c) => c.file_path === file.path
              ).length;
              return (
                <button
                  key={i}
                  onClick={() => setSelectedFile(file.path)}
                  className="flex items-center gap-2 px-3 py-1.5 w-full text-left hover:bg-[#1a1d27] transition-colors"
                >
                  <span
                    className={`w-4 text-center text-[10px] font-bold ${st.color}`}
                  >
                    {st.label}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono truncate flex-1">
                    {file.path}
                  </span>
                  {fileCommentCount > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-1.5 text-[9px] font-semibold text-amber-400">
                      {fileCommentCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Right Panel: Files + Changes + Checks + PR + Terminal ──────────────

type RightTab = "files" | "changes" | "checks" | "pr" | "terminal";

export default function WorkspaceRightPanel({
  workspace,
  onShowCreatePr,
  onWorkspaceRefresh,
  onNavigateReview,
}: {
  workspace: WorkspaceRow;
  onShowCreatePr: () => void;
  onWorkspaceRefresh: () => void;
  onNavigateReview?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<RightTab>(
    workspace.pr_number ? "pr" : "files"
  );
  const [gitStatus, setGitStatus] = useState<{
    changed_files: number;
  } | null>(null);
  const [_gitLoading, setGitLoading] = useState(false);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    let cancelled = false;
    setGitLoading(true);
    getWorkspaceGitStatus(workspace.id)
      .then((result) => {
        if (!cancelled) setGitStatus(result);
      })
      .catch(() => {
        if (!cancelled) setGitStatus(null);
      })
      .finally(() => {
        if (!cancelled) setGitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace.id, workspace.updated_at]);

  const changedCount = gitStatus?.changed_files ?? 0;

  const tabClass = (tab: RightTab) =>
    `px-2.5 py-2 text-[11px] font-medium transition-colors relative ${
      activeTab === tab
        ? "text-slate-200 border-b-2 border-amber-400"
        : "text-slate-500 hover:text-slate-300 border-b-2 border-transparent"
    }`;

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[#1e2231] shrink-0">
        <button
          onClick={() => setActiveTab("files")}
          className={tabClass("files")}
        >
          Files
        </button>
        <button
          onClick={() => setActiveTab("changes")}
          className={tabClass("changes")}
        >
          Changes
          {changedCount > 0 && (
            <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0 text-[9px] font-semibold text-amber-400">
              {changedCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("checks")}
          className={tabClass("checks")}
        >
          Checks
        </button>
        <button
          onClick={() => setActiveTab("pr")}
          className={tabClass("pr")}
        >
          PR
          {workspace.pr_number && (
            <span className="ml-1 text-[9px] text-amber-400/60">
              #{workspace.pr_number}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("terminal")}
          className={tabClass("terminal")}
        >
          Term
        </button>
        {/* Review button */}
        <div className="ml-auto pr-2">
          <button
            onClick={onNavigateReview}
            className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400 hover:bg-indigo-500/20 transition-colors"
          >
            Review
          </button>
        </div>
      </div>

      {/* Tab content — terminal manages its own scroll */}
      <div className={`flex-1 ${activeTab === "terminal" ? "overflow-hidden" : "overflow-y-auto"}`}>
        {activeTab === "files" ? (
          <FileTreePanel workspace={workspace} />
        ) : activeTab === "changes" ? (
          <ChangesPanel workspace={workspace} />
        ) : activeTab === "checks" ? (
          <ChecksPanel workspace={workspace} />
        ) : activeTab === "pr" ? (
          /* PR status panel */
          <div>
            {workspace.pr_number ? (
              <PrStatusPanel
                workspace={workspace}
                onPrUpdate={onWorkspaceRefresh}
              />
            ) : (
              <div className="p-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-3">
                  Pull Request
                </div>
                <div className="flex flex-col items-center gap-3 py-6">
                  <p className="text-[11px] text-slate-500 text-center">
                    No pull request linked yet
                  </p>
                  <button
                    onClick={onShowCreatePr}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-amber-400"
                  >
                    Create Pull Request
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Real integrated terminal */
          <div className="flex flex-col h-full">
            <TerminalPanel
              cwd={workspace.repo_path}
              terminalId={`ws-terminal-${workspace.id}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
