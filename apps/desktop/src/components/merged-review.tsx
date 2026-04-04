import type { MergedReviewResult, MergedFindingResult } from "@/lib/tauri-ipc";

// ─── Severity Config ─────────────────────────────────────────────────────────

const severityConfig: Record<
  string,
  { icon: string; color: string; bg: string; text: string; border: string; barColor: string }
> = {
  critical: {
    icon: "\u2716",
    color: "red",
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/20",
    barColor: "bg-red-500",
  },
  high: {
    icon: "\u26A0",
    color: "rose",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/20",
    barColor: "bg-rose-500",
  },
  medium: {
    icon: "\u25CF",
    color: "amber",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
    barColor: "bg-amber-500",
  },
  warning: {
    icon: "\u25CF",
    color: "amber",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
    barColor: "bg-amber-500",
  },
  low: {
    icon: "\u00B7",
    color: "slate",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
    barColor: "bg-slate-500",
  },
  suggestion: {
    icon: "\u2731",
    color: "blue",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
    barColor: "bg-blue-500",
  },
  info: {
    icon: "\u2022",
    color: "slate",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
    barColor: "bg-slate-500",
  },
};

const defaultSevConfig = severityConfig.info;

function getSevConfig(severity: string) {
  return severityConfig[severity.toLowerCase()] ?? defaultSevConfig;
}

// ─── Helper: format duration ─────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  return `${seconds}s`;
}

// ─── Severity Bar ────────────────────────────────────────────────────────────

interface SeverityBarProps {
  findings: MergedFindingResult[];
}

function SeverityBar({ findings }: SeverityBarProps) {
  const unique = findings.filter((f) => !f.is_duplicate);
  const counts: Record<string, number> = {};
  for (const f of unique) {
    const sev = f.finding.severity.toLowerCase();
    counts[sev] = (counts[sev] ?? 0) + 1;
  }

  const total = unique.length;
  if (total === 0) return null;

  const order = ["critical", "high", "medium", "warning", "low", "suggestion", "info"];
  const segments = order
    .filter((s) => counts[s])
    .map((s) => ({ severity: s, count: counts[s], pct: (counts[s] / total) * 100 }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#1a1a1a]">
        {segments.map((seg) => (
          <div
            key={seg.severity}
            className={`${getSevConfig(seg.severity).barColor} transition-all`}
            style={{ width: `${seg.pct}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map((seg) => (
          <span key={seg.severity} className={getSevConfig(seg.severity).text}>
            {seg.count} {seg.severity}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Finding Card ────────────────────────────────────────────────────────────

interface MergedFindingCardProps {
  mf: MergedFindingResult;
}

function MergedFindingCard({ mf }: MergedFindingCardProps) {
  const config = getSevConfig(mf.finding.severity);
  const location = mf.finding.line_start > 0
    ? `${mf.finding.file}:${mf.finding.line_start}`
    : mf.finding.file;

  return (
    <div
      className={`rounded-xl border ${config.border} ${config.bg} p-4 transition-colors ${
        mf.is_duplicate ? "opacity-40" : ""
      }`}
    >
      {/* Header row */}
      <div className="mb-2 flex items-start gap-2">
        <span className={`mt-0.5 text-sm ${config.text}`}>{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4
              className={`text-sm font-medium text-slate-200 truncate ${
                mf.is_duplicate ? "line-through" : ""
              }`}
            >
              {mf.finding.message.length > 120
                ? mf.finding.message.slice(0, 120) + "..."
                : mf.finding.message}
            </h4>
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text}`}
            >
              {mf.finding.severity}
            </span>
          </div>

          {/* File location */}
          <p className="mono mt-0.5 text-xs text-slate-500">{location}</p>
        </div>
      </div>

      {/* Message body */}
      {!mf.is_duplicate && (
        <p className="text-xs leading-relaxed text-slate-400">
          {mf.finding.message}
        </p>
      )}

      {/* Sources / agents */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {mf.sources.map((src) => (
          <span
            key={src}
            className="rounded-md bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-slate-400"
          >
            {src.length > 12 ? src.slice(0, 8) + "..." : src}
          </span>
        ))}
        {mf.is_duplicate && (
          <span className="text-[10px] text-slate-600 italic">
            (duplicate)
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface MergedReviewProps {
  result: MergedReviewResult;
  onClose?: () => void;
}

export default function MergedReview({ result, onClose }: MergedReviewProps) {
  const uniqueFindings = result.findings.filter((f) => !f.is_duplicate);
  const duplicateFindings = result.findings.filter((f) => f.is_duplicate);

  return (
    <div className="flex flex-col gap-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Coordinated Review Results
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Close
          </button>
        )}
      </div>

      {/* Summary stats */}
      <div className="rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-6">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="text-lg font-bold text-amber-400">
            {result.agents_involved.length} agent{result.agents_involved.length !== 1 ? "s" : ""}
          </span>
          <span className="text-lg font-bold text-slate-300">
            {result.total_files_reviewed} file{result.total_files_reviewed !== 1 ? "s" : ""}
          </span>
          <span className="text-lg font-bold text-slate-300">
            {formatDuration(result.duration_seconds)}
          </span>
        </div>

        <p className="mt-2 text-sm text-slate-400">
          {result.unique_count} finding{result.unique_count !== 1 ? "s" : ""}
          {result.duplicate_count > 0 && (
            <span className="text-slate-600">
              {" "}({result.duplicate_count} duplicate{result.duplicate_count !== 1 ? "s" : ""} removed)
            </span>
          )}
        </p>

        {/* Severity bar */}
        <div className="mt-4">
          <SeverityBar findings={result.findings} />
        </div>
      </div>

      {/* Summary text */}
      {result.summary && (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Summary
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
            {result.summary}
          </p>
        </div>
      )}

      {/* Unique findings */}
      {uniqueFindings.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Findings ({uniqueFindings.length})
          </h3>
          {uniqueFindings.map((mf) => (
            <MergedFindingCard key={mf.finding.id} mf={mf} />
          ))}
        </div>
      ) : (
        <p className="text-sm italic text-slate-500">
          No findings - clean code!
        </p>
      )}

      {/* Duplicate findings (collapsed section) */}
      {duplicateFindings.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-400 transition-colors">
            {duplicateFindings.length} duplicate{duplicateFindings.length !== 1 ? "s" : ""} (click to expand)
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            {duplicateFindings.map((mf) => (
              <MergedFindingCard key={mf.finding.id} mf={mf} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
