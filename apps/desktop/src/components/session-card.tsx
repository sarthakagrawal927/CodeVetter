import type { SessionRow } from "@/lib/tauri-ipc";

interface SessionCardProps {
  session: SessionRow;
  onClick?: () => void;
  selected?: boolean;
  focused?: boolean;
  isLive?: boolean;
}

const agentDot: Record<string, string> = {
  "claude-code": "bg-amber-400",
  codex: "bg-emerald-400",
};

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo`;
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

function extractProjectName(session: SessionRow): string {
  if (session.cwd) {
    const parts = session.cwd.split("/");
    return parts[parts.length - 1] || session.cwd;
  }
  return "Session";
}

function shortenPath(cwd: string): string {
  const home = "/Users/";
  if (cwd.startsWith(home)) {
    const afterHome = cwd.slice(home.length);
    const slashIdx = afterHome.indexOf("/");
    if (slashIdx >= 0) {
      return "~" + afterHome.slice(slashIdx);
    }
  }
  return cwd;
}

export default function SessionCard({
  session,
  onClick,
  selected = false,
  focused = false,
  isLive = false,
}: SessionCardProps) {
  const dot = agentDot[session.agent_type] ?? "bg-slate-400";
  const totalTokens = session.total_input_tokens + session.total_output_tokens;

  return (
    <button
      onClick={onClick}
      className={`group flex w-full flex-col px-3 py-1.5 text-left transition-colors border-l-2 ${
        selected
          ? "bg-amber-500/8 border-l-amber-400"
          : focused
          ? "bg-[#1a1d27] border-l-transparent"
          : "border-l-transparent hover:bg-[#1a1d27]"
      }`}
    >
      {/* Row 1: project, branch, tokens, age */}
      <div className="flex w-full items-center gap-3 text-[13px]">
        {isLive ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" title="Live session" />
        ) : (
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        )}

        <span className="truncate font-medium text-slate-200 min-w-0 max-w-[140px]">
          {extractProjectName(session)}
        </span>

        {isLive && (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400/80">
            Live
          </span>
        )}

        {session.git_branch && (
          <span className="truncate text-[11px] text-slate-500 max-w-[140px] font-mono">
            {session.git_branch}
          </span>
        )}

        <span className="flex-1" />

        {totalTokens > 0 && (
          <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
            {formatTokenCount(totalTokens)}
          </span>
        )}

        <span className="shrink-0 w-[28px] text-right text-[11px] text-slate-600 tabular-nums">
          {formatRelativeTime(session.last_message)}
        </span>
      </div>

      {/* Row 2: full path */}
      {session.cwd && (
        <div className="flex items-center gap-3 ml-5">
          <span className="truncate text-[11px] text-slate-600 font-mono">
            {shortenPath(session.cwd)}
          </span>
        </div>
      )}
    </button>
  );
}
