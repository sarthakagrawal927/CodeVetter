import type { Task, AgentProcess } from "@/lib/tauri-ipc";
import type { LoopState } from "@/lib/review-loop";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface KanbanBoardProps {
  tasks: Task[];
  loopStates?: Map<string, LoopState>;
  runningAgents?: AgentProcess[];
  onTaskClick?: (task: Task) => void;
  onAddTask?: (column: string) => void;
  onAssignAgent?: (task: Task) => void;
}

interface ColumnDef {
  id: string;
  label: string;
  icon: string;
  color: string;
}

const columns: ColumnDef[] = [
  { id: "todo", label: "To Do", icon: "\u2610", color: "text-slate-400" },
  { id: "in_progress", label: "In Progress", icon: "\u25B6", color: "text-amber-400" },
  { id: "in_review", label: "Review", icon: "\u2714", color: "text-yellow-400" },
  { id: "in_test", label: "Test", icon: "\u25B6", color: "text-blue-400" },
  { id: "done", label: "Done", icon: "\u2713", color: "text-emerald-400" },
];

function LoopBadge({ loopState }: { loopState: LoopState }) {
  switch (loopState.status) {
    case "reviewing":
      return (
        <Badge variant="outline" className="animate-pulse border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-400 px-1.5 py-0">
          Reviewing...
        </Badge>
      );
    case "waiting_for_fix":
      return (
        <Badge variant="outline" className="border-yellow-500/40 bg-yellow-500/10 text-[10px] text-yellow-400 px-1.5 py-0">
          Fix attempt {loopState.attempt}/{loopState.maxAttempts}
        </Badge>
      );
    case "passed":
      return (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400 px-1.5 py-0">
          Passed &#10003; {loopState.lastScore}
        </Badge>
      );
    case "failed_max_attempts":
      return (
        <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-[10px] text-red-400 px-1.5 py-0">
          Failed ({loopState.lastScore})
        </Badge>
      );
    default:
      return null;
  }
}

function ScoreTrend({ history }: { history: LoopState["reviewHistory"] }) {
  if (history.length < 2) return null;
  return (
    <span className="text-[10px] text-slate-500">
      {history.map((h) => Math.round(h.score)).join(" \u2192 ")}
    </span>
  );
}

function TaskCard({
  task,
  loopState,
  isAgentRunning,
  onClick,
  onAssign,
}: {
  task: Task;
  loopState?: LoopState;
  isAgentRunning?: boolean;
  onClick?: () => void;
  onAssign?: () => void;
}) {
  return (
    <Card className="group/task w-full border-[#1a1a1a] bg-[#0f1117] transition-all hover:border-[#2d3348] hover:bg-[#0a0a0a] overflow-hidden">
      <CardContent className="p-3 min-w-0">
        <div className="cursor-pointer" onClick={onClick}>
          <h5 className="text-xs font-medium text-slate-200 line-clamp-2">
            {task.title}
          </h5>
          {task.description && (
            <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
              {task.description}
            </p>
          )}
        </div>

        {loopState && loopState.status !== "idle" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <LoopBadge loopState={loopState} />
            <ScoreTrend history={loopState.reviewHistory} />
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          {task.assigned_agent ? (
            <div className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${isAgentRunning ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <span className={`mono text-[10px] ${isAgentRunning ? "text-emerald-400" : "text-amber-400"}`}>
                {task.assigned_agent.slice(0, 8)}
              </span>
              {isAgentRunning && (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400/80">
                  Live
                </span>
              )}
            </div>
          ) : onAssign ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onAssign(); }}
              className="h-auto px-1 py-0 text-[10px] text-slate-600 hover:text-amber-400 opacity-0 group-hover/task:opacity-100"
            >
              Assign agent
            </Button>
          ) : null}
          {task.review_score != null && (
            <span className="text-[10px] text-slate-500">
              Score: {Math.round(task.review_score)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Check if a task's assigned agent is currently running by matching project_path. */
function isTaskAgentRunning(task: Task, runningAgents?: AgentProcess[]): boolean {
  if (!task.assigned_agent || !runningAgents) return false;
  return runningAgents.some(
    (a) =>
      a.status === "running" &&
      a.project_path === task.project_path
  );
}

export default function KanbanBoard({ tasks, loopStates, runningAgents, onTaskClick, onAddTask, onAssignAgent }: KanbanBoardProps) {
  return (
    <div className="grid grid-cols-5 gap-3 min-w-[750px]">
      {columns.map((col) => {
        const colTasks = tasks.filter((t) => {
          if (t.status === col.id) return true;
          // Map legacy statuses to columns
          if (col.id === "todo" && (t.status === "backlog" || t.status === "pending")) return true;
          if (col.id === "in_progress" && t.status === "in_progress") return true;
          if (col.id === "in_review" && t.status === "in_review") return true;
          if (col.id === "done" && t.status === "done") return true;
          return false;
        });
        return (
          <div key={col.id} className="flex flex-col gap-2">
            {/* Column header */}
            <div className="group/header flex items-center gap-2 px-1 pb-1">
              <span className={`text-xs ${col.color}`}>{col.icon}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {col.label}
              </span>
              <span className="rounded-full bg-[#111111] px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                {colTasks.length}
              </span>
              {onAddTask && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onAddTask(col.id)}
                  className="ml-auto h-6 w-6 text-sm text-slate-600 opacity-0 hover:text-amber-400 group-hover/header:opacity-100"
                >
                  +
                </Button>
              )}
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-2 min-h-[120px]">
              {colTasks.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-slate-600">
                  No tasks
                </p>
              ) : (
                colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    loopState={loopStates?.get(task.id)}
                    isAgentRunning={isTaskAgentRunning(task, runningAgents)}
                    onClick={() => onTaskClick?.(task)}
                    onAssign={onAssignAgent ? () => onAssignAgent(task) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
