import type { AgentProcess } from "@/lib/tauri-ipc";

interface AgentCardProps {
  agent: AgentProcess;
  onStop?: (id: string) => void;
}

const statusConfig: Record<string, { dot: string; label: string; color: string }> = {
  running: { dot: "bg-emerald-400", label: "Running", color: "text-emerald-400" },
  paused: { dot: "bg-orange-400", label: "Paused", color: "text-orange-400" },
  stopped: { dot: "bg-slate-500", label: "Stopped", color: "text-slate-400" },
  completed: { dot: "bg-blue-400", label: "Completed", color: "text-blue-400" },
};

const defaultStatusConfig = { dot: "bg-slate-500", label: "Unknown", color: "text-slate-400" };

const adapterIcons: Record<string, string> = {
  "claude-code": "\u25C8",
  codex: "\u25A0",
};

export default function AgentCard({ agent, onStop }: AgentCardProps) {
  const status = statusConfig[agent.status] ?? defaultStatusConfig;
  const icon = adapterIcons[agent.agent_type] ?? "\u25CF";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#1e2231] bg-[#13151c] p-4 transition-colors hover:border-[#2d3348]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base text-amber-400">{icon}</span>
          <div>
            <h4 className="text-sm font-medium text-slate-200">
              {agent.display_name ?? `${agent.agent_type} agent`}
            </h4>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">
              {agent.agent_type}
              {agent.role ? ` / ${agent.role}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${status.dot} ${
              agent.status === "running" ? "pulse-dot" : ""
            }`}
          />
          <span className={`text-[11px] font-medium ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Project path */}
      {agent.project_path && (
        <p className="mono line-clamp-1 text-xs text-slate-500">
          {agent.project_path}
        </p>
      )}

      {/* PID + cost info */}
      <div className="flex items-center gap-3 text-[10px] text-slate-600">
        {agent.pid != null && <span>PID: {agent.pid}</span>}
        {agent.estimated_cost_usd > 0 && (
          <span>${agent.estimated_cost_usd.toFixed(4)}</span>
        )}
        {agent.started_at && (
          <span>{new Date(agent.started_at).toLocaleTimeString()}</span>
        )}
      </div>

      {/* Actions */}
      {agent.status === "running" && onStop && (
        <button
          onClick={() => onStop(agent.id)}
          className="mt-auto self-end rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
        >
          Stop
        </button>
      )}
    </div>
  );
}
