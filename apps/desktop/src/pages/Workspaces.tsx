import {
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { WorkspaceRow } from "@/lib/tauri-ipc";
import CreatePrModal from "@/components/create-pr-modal";
import WorkspaceChat from "@/components/workspace-chat";
import WorkspaceRightPanel from "@/components/workspace-right-panel";
import WorkspaceTopBar from "@/components/workspace-top-bar";
import CreateWorkspaceModal from "@/components/create-workspace-modal";
import ReviewDashboard from "@/components/review-dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config =
    STATUS_CONFIG[status as WorkspaceStatus] ?? STATUS_CONFIG.backlog;
  return (
    <Badge
      variant="outline"
      className={`text-[9px] font-medium px-1.5 py-0.5 ${config.color} ${config.bg} ${config.border}`}
    >
      {config.label}
    </Badge>
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
      <Button
        variant="ghost"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-start gap-2 px-3 py-2 h-auto rounded-none text-[11px] font-medium uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors w-full"
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
      </Button>

      {!collapsed && (
        <div className="flex flex-col">
          {workspaces.map((ws) => (
            <Button
              key={ws.id}
              variant="ghost"
              onClick={() => onSelect(ws.id)}
              className={`flex flex-col gap-1 px-3 py-2.5 h-auto rounded-none text-left border-b border-[#1e2231]/50 transition-colors w-full ${
                selectedId === ws.id
                  ? "bg-amber-500/5 border-l-2 border-l-amber-500"
                  : "hover:bg-[#1a1d27] border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 w-full">
                <span className="text-[13px] font-medium text-slate-200 truncate flex-1">
                  {ws.name}
                </span>
                <StatusBadge status={ws.status} />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 w-full">
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
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Workspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreatePr, setShowCreatePr] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showReview, setShowReview] = useState(false);

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
    <div className="flex h-full overflow-hidden">
      {/* Left panel: workspace list */}
      <div className="flex w-[280px] min-w-[200px] shrink-0 flex-col border-r border-[#1e2231] overflow-hidden">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreate(true)}
            className="h-auto px-2.5 py-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15 hover:text-amber-400"
          >
            + New
          </Button>
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
              <Button
                variant="ghost"
                onClick={loadWorkspaces}
                className="mt-2 h-auto px-0 py-0 text-[11px] text-slate-500 hover:text-slate-300"
              >
                Retry
              </Button>
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-[13px] text-slate-500 mb-1">
                No workspaces yet
              </p>
              <p className="text-[11px] text-slate-600 mb-3">
                Create one to start tracking a branch
              </p>
              <Button
                variant="link"
                size="sm"
                onClick={() => setShowCreate(true)}
                className="h-auto px-0 py-0 text-[11px] text-amber-400 hover:text-amber-300"
              >
                Create workspace
              </Button>
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
          {showReview ? (
            /* ── Review Dashboard (full center area) ── */
            <div className="flex-1 min-w-0 flex flex-col">
              <ReviewDashboard
                key={`review-${selectedWorkspace.id}`}
                workspace={selectedWorkspace}
                onClose={() => setShowReview(false)}
              />
            </div>
          ) : (
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
                  showRightPanel ? "w-[280px] min-w-[200px]" : "w-0"
                } overflow-hidden`}
              >
                {showRightPanel && (
                  <WorkspaceRightPanel
                    workspace={selectedWorkspace}
                    onShowCreatePr={() => setShowCreatePr(true)}
                    onWorkspaceRefresh={loadWorkspaces}
                    onNavigateReview={() => setShowReview(true)}
                  />
                )}
              </div>

              {/* Toggle button (fixed to right edge of center) */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowRightPanel(!showRightPanel)}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 rounded-l-md rounded-r-none bg-[#1a1d27] border border-r-0 border-[#1e2231] px-1 py-3 h-auto w-auto text-slate-500 hover:text-slate-300 transition-colors"
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
              </Button>
            </>
          )}
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
      <CreateWorkspaceModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

      {/* Create PR modal */}
      {showCreatePr && selectedWorkspace && (
        <CreatePrModal
          workspace={selectedWorkspace}
          onClose={() => setShowCreatePr(false)}
          onCreated={async () => {
            setShowCreatePr(false);
            await loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}
