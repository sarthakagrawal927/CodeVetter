interface ContextMeterProps {
  inputTokens: number;
  outputTokens: number;
  maxTokens?: number;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Subtle context usage indicator for chat bottom bars.
 * Shows approximate token usage as text + thin progress bar.
 */
export default function ContextMeter({
  inputTokens,
  outputTokens,
  maxTokens = 200_000,
}: ContextMeterProps) {
  const total = inputTokens + outputTokens;
  if (total === 0) return null;

  const pct = Math.min((total / maxTokens) * 100, 100);
  const color =
    pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-slate-600";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-600 tabular-nums">
        {formatTokens(total)} / {formatTokens(maxTokens)} tokens
      </span>
      <div className="w-16 h-1 rounded-full bg-[#1a1a1a] overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
