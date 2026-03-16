import type { ActivityEvent } from "@/lib/tauri-ipc";

interface ActivityFeedProps {
  events: ActivityEvent[];
}

const typeConfig: Record<string, { icon: string; color: string }> = {
  file_edit: { icon: "\u270E", color: "text-blue-400" },
  command_run: { icon: "\u25B8", color: "text-emerald-400" },
  review_started: { icon: "\u23F3", color: "text-yellow-400" },
  review_completed: { icon: "\u2714", color: "text-amber-400" },
  pr_review_started: { icon: "\u23F3", color: "text-yellow-400" },
  task_created: { icon: "\u2610", color: "text-blue-400" },
  task_updated: { icon: "\u2610", color: "text-yellow-400" },
  agent_launched: { icon: "\u25B6", color: "text-emerald-400" },
  agent_stopped: { icon: "\u25A0", color: "text-red-400" },
  agent_message: { icon: "\u25CB", color: "text-slate-400" },
  error: { icon: "\u2716", color: "text-red-400" },
};

const defaultTypeConfig = { icon: "\u25CF", color: "text-slate-400" };

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function ActivityFeed({ events }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-600">
        <span className="text-2xl mb-2">{"\u25CB"}</span>
        <p className="text-xs">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {events.map((event, idx) => {
        const config = typeConfig[event.event_type ?? ""] ?? defaultTypeConfig;
        const isLast = idx === events.length - 1;
        return (
          <div key={event.id} className="flex gap-3">
            {/* Timeline gutter */}
            <div className="flex flex-col items-center">
              <span className={`text-xs ${config.color}`}>{config.icon}</span>
              {!isLast && (
                <div className="w-px flex-1 bg-[#1e2231] my-1" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-slate-300">
                  {event.event_type?.replace(/_/g, " ") ?? "event"}
                </span>
                <span className="mono text-[10px] text-slate-600">
                  {formatTime(event.created_at)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">
                {event.summary}
              </p>
              {event.agent_id && (
                <span className="mono text-[10px] text-amber-400/50">
                  agent:{event.agent_id.slice(0, 8)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
