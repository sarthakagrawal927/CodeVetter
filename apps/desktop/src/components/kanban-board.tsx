import type { Task } from "@/lib/tauri-ipc";

interface KanbanBoardProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onAddTask?: (column: string) => void;
}

interface ColumnDef {
  id: string;
  label: string;
  icon: string;
  color: string;
}

const columns: ColumnDef[] = [
  { id: "backlog", label: "Backlog", icon: "\u2610", color: "text-slate-400" },
  { id: "in_progress", label: "In Progress", icon: "\u25B6", color: "text-amber-400" },
  { id: "in_review", label: "Review", icon: "\u2714", color: "text-yellow-400" },
  { id: "in_test", label: "Test", icon: "\u25B6", color: "text-blue-400" },
  { id: "done", label: "Done", icon: "\u2713", color: "text-emerald-400" },
];

function TaskCard({
  task,
  onClick,
}: {
  task: Task;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-[#1e2231] bg-[#0f1117] p-3 text-left transition-all hover:border-[#2d3348] hover:bg-[#13151c]"
    >
      <h5 className="text-xs font-medium text-slate-200 line-clamp-2">
        {task.title}
      </h5>
      {task.description && (
        <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {task.assigned_agent && (
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="mono text-[10px] text-amber-400">
              {task.assigned_agent.slice(0, 8)}
            </span>
          </div>
        )}
        {task.review_score != null && (
          <span className="text-[10px] text-slate-500">
            Score: {Math.round(task.review_score)}
          </span>
        )}
      </div>
    </button>
  );
}

export default function KanbanBoard({ tasks, onTaskClick, onAddTask }: KanbanBoardProps) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {columns.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.id);
        return (
          <div key={col.id} className="flex flex-col gap-2">
            {/* Column header */}
            <div className="group/header flex items-center gap-2 px-1 pb-1">
              <span className={`text-xs ${col.color}`}>{col.icon}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {col.label}
              </span>
              <span className="rounded-full bg-[#1a1d27] px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                {colTasks.length}
              </span>
              {onAddTask && (
                <button
                  onClick={() => onAddTask(col.id)}
                  className="ml-auto text-sm text-slate-600 opacity-0 transition-opacity hover:text-amber-400 group-hover/header:opacity-100"
                >
                  +
                </button>
              )}
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 rounded-xl border border-[#1e2231] bg-[#13151c] p-2 min-h-[120px]">
              {colTasks.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-slate-600">
                  No tasks
                </p>
              ) : (
                colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => onTaskClick?.(task)}
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
