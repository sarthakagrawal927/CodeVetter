import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  getWorkspaceGitStatus,
  getSession,
  sendChatMessage,
  pickDirectory,
  isTauriAvailable,
  listDirectoryTree,
  readFilePreview,
  openInApp,
  getGitRemoteInfo,
  getGitChangedFiles,
  listCiChecks,
  getFileDiff,
  listDiffComments,
  createDiffComment,
  deleteDiffComment,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow, FileEntry, FilePreview, CICheck, GitChangedFile, DiffComment } from "@/lib/tauri-ipc";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { RateLimitEventInfo } from "@/hooks/use-chat-stream";
import ContextMeter from "@/components/context-meter";
import CapacityIndicator from "@/components/capacity-indicator";
import type { RateLimitInfo } from "@/components/capacity-indicator";
import CreatePrModal from "@/components/create-pr-modal";
import DiffViewer from "@/components/diff-viewer";
import PrStatusPanel from "@/components/pr-status-panel";
import TerminalPanel from "@/components/terminal-panel";

// ─── Helpers ────────────────────────────────────────────────────────────────

type WorkspaceStatus = "in_progress" | "in_review" | "backlog" | "done";

const STATUS_CONFIG: Record<
  WorkspaceStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  in_progress: {
    label: "In Progress",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  in_review: {
    label: "In Review",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  backlog: {
    label: "Backlog",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
  },
  done: {
    label: "Done",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
};

const STATUS_ORDER: WorkspaceStatus[] = [
  "in_progress",
  "in_review",
  "backlog",
  "done",
];

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

function repoName(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() || repoPath;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Chat message type for local state ──────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

type ChatState = "idle" | "waiting" | "streaming";

function convertSessionMessages(
  msgs: { role: string | null; content_text: string | null }[]
): ChatMessage[] {
  return msgs
    .filter((m) => m.content_text?.trim())
    .filter(
      (m) => m.role === "user" || m.role === "human" || m.role === "assistant"
    )
    .map((m) => ({
      role: (m.role === "human" ? "user" : m.role) as "user" | "assistant",
      content: m.content_text!,
    }));
}

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config =
    STATUS_CONFIG[status as WorkspaceStatus] ?? STATUS_CONFIG.backlog;
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium ${config.color} ${config.bg} border ${config.border}`}
    >
      {config.label}
    </span>
  );
}

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

// ─── Top Bar (breadcrumb + actions) ─────────────────────────────────────

function WorkspaceTopBar({
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

// ─── File Preview Modal ─────────────────────────────────────────────────

// (Inline preview is in FileTreePanel above)

// ─── Create Workspace Modal ─────────────────────────────────────────────────

function CreateWorkspaceModal({
  onClose,
  onCreate,
}: {
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

// ─── Collapsible Group ──────────────────────────────────────────────────────

function WorkspaceGroup({
  status,
  workspaces,
  selectedId,
  onSelect,
}: {
  status: WorkspaceStatus;
  workspaces: WorkspaceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const config = STATUS_CONFIG[status];

  if (workspaces.length === 0) return null;

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
      >
        <svg
          className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        <span className={config.color}>{config.label}</span>
        <span className="text-slate-600">{workspaces.length}</span>
      </button>

      {!collapsed && (
        <div className="flex flex-col">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => onSelect(ws.id)}
              className={`flex flex-col gap-1 px-3 py-2.5 text-left border-b border-[#1e2231]/50 transition-colors ${
                selectedId === ws.id
                  ? "bg-amber-500/5 border-l-2 border-l-amber-500"
                  : "hover:bg-[#1a1d27] border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-medium text-slate-200 truncate flex-1">
                  {ws.name}
                </span>
                <StatusBadge status={ws.status} />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-mono truncate max-w-[120px]">
                  {ws.branch}
                </span>
                <span className="text-slate-600">{"·"}</span>
                <span className="truncate">{repoName(ws.repo_path)}</span>
                {ws.pr_number && (
                  <>
                    <span className="text-slate-600">{"·"}</span>
                    <span className="text-amber-400/60">
                      #{ws.pr_number}
                    </span>
                  </>
                )}
                <span className="ml-auto shrink-0 text-slate-600">
                  {formatRelativeTime(ws.updated_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Workspace Chat Panel (center) ──────────────────────────────────────────

function WorkspaceChat({
  workspace,
  onSessionCreated,
}: {
  workspace: WorkspaceRow;
  onSessionCreated: (sessionId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("sonnet");
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | undefined>(workspace.session_id ?? undefined);

  // Track current workspace to detect changes
  const prevWorkspaceId = useRef(workspace.id);

  // ─── Stream handler ─────────────────────────────────────────────────────

  const { sending, streamingText, stats: chatStats } = useChatStream({
    onAssistantDone(text, newSessionId) {
      setChatState("idle");
      if (text.trim()) {
        setMessages((prev) => [...prev, { role: "assistant", content: text }]);
      }
      if (newSessionId && newSessionId !== sessionIdRef.current) {
        sessionIdRef.current = newSessionId;
        onSessionCreated(newSessionId);
      }
      inputRef.current?.focus();
    },
    onSystemMessage(text) {
      setChatState("idle");
      setMessages((prev) => [...prev, { role: "system", content: text }]);
    },
    onTextUpdate() {
      if (chatState !== "streaming") setChatState("streaming");
    },
    onRateLimitUpdate(info: RateLimitEventInfo) {
      setRateLimitInfo(info);
    },
  });

  // Sync sending state
  useEffect(() => {
    if (sending && chatState === "waiting") setChatState("streaming");
  }, [sending, chatState]);

  // ─── Load history when workspace changes ────────────────────────────────

  useEffect(() => {
    if (prevWorkspaceId.current !== workspace.id) {
      prevWorkspaceId.current = workspace.id;
      setMessages([]);
      setChatState("idle");
      setInput("");
      sessionIdRef.current = workspace.session_id ?? undefined;
    }

    if (!workspace.session_id || !isTauriAvailable()) {
      setLoadingHistory(false);
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      try {
        const { messages: msgs } = await getSession(workspace.session_id!);
        if (cancelled) return;
        setMessages(convertSessionMessages(msgs));
      } catch (err) {
        console.error("Failed to load workspace session:", err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspace.id, workspace.session_id]);

  // ─── Auto-scroll ──────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, loadingHistory, chatState]);

  // ─── Send ─────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || chatState !== "idle") return;

    const finalMsg = planMode ? `/plan ${msg}` : msg;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatState("waiting");

    try {
      await sendChatMessage(
        finalMsg,
        sessionIdRef.current,
        workspace.repo_path,
        thinkingEnabled ? `${model}-thinking` : model
      );
    } catch (err) {
      setChatState("idle");
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }, [input, chatState, workspace.repo_path, model, thinkingEnabled, planMode]);

  const isBusy = chatState !== "idle";

  // ─── Markdown prose classes (matching chat-viewer.tsx) ─────────────────────

  const proseClasses =
    "text-sm leading-relaxed text-slate-300 prose prose-invert prose-sm max-w-none prose-pre:bg-[#0d0f16] prose-pre:border prose-pre:border-[#1e2231] prose-pre:rounded-lg prose-code:text-amber-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-a:text-amber-400 prose-strong:text-slate-200 prose-headings:text-slate-200 prose-li:marker:text-slate-500";

  return (
    <div className="flex h-full flex-col">
      {/* Chat header */}
      <div className="flex items-center gap-2 border-b border-[#1e2231] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-1.5 rounded-md bg-[#1a1d27] px-2.5 py-1 text-[11px] text-slate-300 font-medium">
          <span className="text-slate-500">#</span>
          {workspace.name}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600 font-mono">
          {workspace.branch}
        </span>
        {workspace.session_id && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400 font-mono">
            {workspace.session_id.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loadingHistory ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            <span className="text-[12px] text-slate-500">
              Loading session history...
            </span>
          </div>
        ) : messages.length === 0 && chatState === "idle" ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-slate-600 text-[13px] text-center max-w-md">
              <p className="text-slate-400 font-medium mb-2">
                Start working on {workspace.name}
              </p>
              <p>
                Send a message to begin coding. Claude has context of{" "}
                <span className="text-slate-400 font-mono text-[12px]">
                  {repoName(workspace.repo_path)}
                </span>
                .
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] rounded-lg bg-amber-500/15 px-4 py-3">
                      <p className="text-[13px] text-slate-200 whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                );
              }
              if (msg.role === "system") {
                return (
                  <div key={i}>
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2">
                      <p className="text-[12px] text-amber-300/80 whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                );
              }
              // assistant
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                      Claude
                    </span>
                  </div>
                  <div className="rounded-lg bg-[#161922] border border-[#1e2231] px-4 py-3">
                    <div className={proseClasses}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Streaming / waiting state */}
            {chatState !== "idle" && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                    Claude
                  </span>
                </div>
                <div className="rounded-lg bg-[#161922] border border-[#1e2231] px-4 py-3">
                  {chatState === "streaming" && streamingText ? (
                    <div className={proseClasses}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingText}
                      </ReactMarkdown>
                      <span className="inline-block w-1.5 h-4 bg-amber-400/50 animate-pulse ml-0.5 align-text-bottom" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          style={{
                            animation: "pulse 1s ease-in-out infinite",
                          }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          style={{
                            animation: "pulse 1s ease-in-out infinite 200ms",
                          }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          style={{
                            animation: "pulse 1s ease-in-out infinite 400ms",
                          }}
                        />
                      </div>
                      <span className="text-[12px] text-slate-500">
                        {chatState === "waiting"
                          ? "Connecting to Claude..."
                          : "Thinking..."}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[#1e2231] px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isBusy
                ? "Waiting for response..."
                : "Ask to make changes, @mention files, run /commands"
            }
            disabled={isBusy}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-[13px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50 disabled:opacity-50 max-h-24"
            style={{ height: "auto", minHeight: "36px" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 96) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={isBusy || !input.trim()}
            className="rounded-lg bg-amber-500 px-3 py-2 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isBusy ? "..." : "Send"}
          </button>
        </div>

        {/* Bottom toolbar: model, thinking, plan */}
        <div className="flex items-center gap-2 mt-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isBusy}
            className="rounded border border-[#1e2231] bg-[#0f1117] px-2 py-1 text-[10px] text-slate-400 outline-none focus:border-amber-500/50 cursor-pointer"
          >
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="haiku">Haiku</option>
          </select>

          <button
            onClick={() => setThinkingEnabled(!thinkingEnabled)}
            disabled={isBusy}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              thinkingEnabled
                ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                : "text-slate-500 hover:text-slate-300 border border-[#1e2231]"
            }`}
          >
            Thinking
          </button>

          <button
            onClick={() => setPlanMode(!planMode)}
            disabled={isBusy}
            className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              planMode
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                : "text-slate-500 hover:text-slate-300 border border-[#1e2231]"
            }`}
          >
            Plan
          </button>

          <span className="ml-auto flex items-center gap-2">
            <CapacityIndicator rateLimitInfo={rateLimitInfo} compact />
            <ContextMeter
              inputTokens={chatStats.inputTokens}
              outputTokens={chatStats.outputTokens}
            />
          </span>
        </div>
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

function WorkspaceRightPanel({
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
  const [gitLoading, setGitLoading] = useState(false);

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

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Workspaces() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreatePr, setShowCreatePr] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);

  // ─── Load workspaces ─────────────────────────────────────────────────

  const loadWorkspaces = useCallback(async () => {
    if (!isTauriAvailable()) {
      setError("Tauri APIs not available. Run inside the desktop app.");
      setLoading(false);
      return;
    }
    try {
      const result = await listWorkspaces();
      setWorkspaces(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  // ─── Grouped workspaces ──────────────────────────────────────────────

  const grouped = useMemo(() => {
    const groups: Record<WorkspaceStatus, WorkspaceRow[]> = {
      in_progress: [],
      in_review: [],
      backlog: [],
      done: [],
    };
    for (const ws of workspaces) {
      if (ws.archived_at) continue;
      const status = ws.status as WorkspaceStatus;
      if (groups[status]) {
        groups[status].push(ws);
      } else {
        groups.backlog.push(ws);
      }
    }
    return groups;
  }, [workspaces]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === selectedId) ?? null,
    [workspaces, selectedId]
  );

  // ─── Handlers ────────────────────────────────────────────────────────

  async function handleCreate(
    name: string,
    repoPath: string,
    branch: string,
    prNumber?: number
  ) {
    try {
      const result = await createWorkspace({
        name,
        repoPath,
        branch,
        prNumber,
      });
      setShowCreate(false);
      await loadWorkspaces();
      setSelectedId(result.id);
    } catch (err) {
      console.error("Failed to create workspace:", err);
    }
  }

  async function handleSessionCreated(sessionId: string) {
    if (!selectedId) return;
    try {
      await updateWorkspace({ id: selectedId, sessionId });
      await loadWorkspaces();
    } catch (err) {
      console.error("Failed to update workspace session:", err);
    }
  }

  const totalCount = workspaces.filter((w) => !w.archived_at).length;

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Left panel: workspace list */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-[#1e2231]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1e2231] px-3 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-100">
              Workspaces
            </h1>
            {!loading && (
              <span className="text-[11px] text-slate-500 tabular-nums">
                {totalCount}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400 hover:bg-amber-500/15 transition-colors"
          >
            + New
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent mb-2" />
              <p className="text-[11px] text-slate-600">Loading...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <p className="text-xs text-red-400 text-center">{error}</p>
              <button
                onClick={loadWorkspaces}
                className="mt-2 text-[11px] text-slate-500 hover:text-slate-300"
              >
                Retry
              </button>
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-[13px] text-slate-500 mb-1">
                No workspaces yet
              </p>
              <p className="text-[11px] text-slate-600 mb-3">
                Create one to start tracking a branch
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-[11px] text-amber-400 hover:text-amber-300"
              >
                Create workspace
              </button>
            </div>
          ) : (
            STATUS_ORDER.map((status) => (
              <WorkspaceGroup
                key={status}
                status={status}
                workspaces={grouped[status]}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))
          )}
        </div>
      </div>

      {/* Center + Right panels */}
      {selectedWorkspace ? (
        <>
          {/* Center: Top bar + Chat */}
          <div className="flex-1 min-w-0 flex flex-col">
            <WorkspaceTopBar
              workspace={selectedWorkspace}
              onShowCreatePr={() => setShowCreatePr(true)}
            />
            <div className="flex-1 min-h-0">
              <WorkspaceChat
                key={selectedWorkspace.id}
                workspace={selectedWorkspace}
                onSessionCreated={handleSessionCreated}
              />
            </div>
          </div>

          {/* Right panel toggle + panel */}
          <div
            className={`shrink-0 border-l border-[#1e2231] transition-all ${
              showRightPanel ? "w-[280px]" : "w-0"
            } overflow-hidden`}
          >
            {showRightPanel && (
              <WorkspaceRightPanel
                workspace={selectedWorkspace}
                onShowCreatePr={() => setShowCreatePr(true)}
                onWorkspaceRefresh={loadWorkspaces}
                onNavigateReview={() => {
                  navigate(`/review?repo=${encodeURIComponent(selectedWorkspace.repo_path)}`);
                }}
              />
            )}
          </div>

          {/* Toggle button (fixed to right edge of center) */}
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 rounded-l-md bg-[#1a1d27] border border-r-0 border-[#1e2231] px-1 py-3 text-slate-500 hover:text-slate-300 transition-colors"
            title={showRightPanel ? "Hide panel" : "Show panel"}
          >
            <svg
              className={`h-3 w-3 transition-transform ${showRightPanel ? "" : "rotate-180"}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
          <p className="text-[13px] text-slate-500">Select a workspace</p>
          <p className="text-[11px] text-slate-600 mt-1">
            or create a new one to get started
          </p>
        </div>
      )}

      {/* Create workspace modal */}
      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Create PR modal */}
      {showCreatePr && selectedWorkspace && (
        <CreatePrModal
          workspace={selectedWorkspace}
          onClose={() => setShowCreatePr(false)}
          onCreated={async (prNumber, prUrl) => {
            setShowCreatePr(false);
            await loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}
