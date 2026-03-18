import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import SessionCard from "@/components/session-card";
import ScoreBadge from "@/components/score-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getIndexStats,
  listSessions,
  listReviews,
  listAgents,
  triggerIndex,
  getPreference,
  listProviderAccounts,
  checkAccountUsage,
  checkLiveUsage,
  deleteProviderAccount,
  detectProviderAccounts,
  isTauriAvailable,
} from "@/lib/tauri-ipc";

import type {
  IndexStats,
  SessionRow,
  LocalReviewRow,
  AgentProcess,
  TriggerIndexResult,
  ProviderAccount,
  AccountUsage,
  LiveUsageResult,
} from "@/lib/tauri-ipc";

// ─── Usage helpers ──────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function planLabel(plan: string | null): string {
  if (!plan) return "";
  const labels: Record<string, string> = {
    max: "Max",
    pro: "Pro",
    plus: "Plus",
    team: "Team",
    enterprise: "Enterprise",
    free: "Free",
  };
  return labels[plan.toLowerCase()] ?? plan;
}

function formatDuration(secs: number): string {
  if (secs <= 0) return "now";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function UsageBar({
  pct,
  label,
  resetLabel,
  color,
  windowTotalSecs,
  resetsInSecs,
}: {
  pct: number;
  label: string;
  resetLabel?: string;
  color: "amber" | "red";
  windowTotalSecs?: number;
  resetsInSecs?: number;
}) {
  const colorMap = {
    amber: { bar: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10" },
    red: { bar: "bg-red-500", text: "text-red-400", bg: "bg-red-500/10" },
  };
  const c = colorMap[color];

  // Reserve / deplete calculation
  // on-track % = (elapsed / total) * 100 — if actual < on-track → in reserve
  let paceLabel: string | null = null;
  let paceColor = "text-slate-500";
  if (windowTotalSecs && resetsInSecs != null && resetsInSecs > 0) {
    const elapsed = windowTotalSecs - resetsInSecs;
    const onTrackPct = (elapsed / windowTotalSecs) * 100;
    const delta = Math.abs(onTrackPct - pct);
    if (pct < onTrackPct - 0.5) {
      paceLabel = `${Math.round(delta)}% in reserve`;
      paceColor = "text-emerald-400/80";
    } else if (pct > onTrackPct + 0.5) {
      paceLabel = `${Math.round(delta)}% ahead of pace`;
      paceColor = "text-red-400/80";
    } else {
      paceLabel = "on pace";
      paceColor = "text-slate-500";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-[12px] font-semibold tabular-nums ${c.text}`}>
            {Math.round(pct)}% used
          </span>
          {paceLabel && (
            <span className={`text-[10px] tabular-nums ${paceColor}`}>
              {paceLabel}
            </span>
          )}
          {resetLabel && (
            <span className="text-[10px] text-slate-600 tabular-nums">
              {resetLabel}
            </span>
          )}
        </div>
      </div>
      <div className={`h-1.5 w-full rounded-full ${c.bg}`}>
        <div
          className={`h-full rounded-full ${c.bar} transition-all duration-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function AccountUsageRow({
  account,
  usage,
  liveUsage,
  onCheckLive,
  checkingLive,
  onDelete: _onDelete,
  isSharedUsage,
}: {
  account: ProviderAccount;
  usage: AccountUsage | null;
  liveUsage: LiveUsageResult | null;
  onCheckLive: () => void;
  checkingLive: boolean;
  onDelete: () => void;
  isSharedUsage: boolean;
}) {
  const weekSessions = usage?.week_sessions ?? 0;
  const weekTokens = (usage?.week_input_tokens ?? 0) + (usage?.week_output_tokens ?? 0);
  const plan = usage?.plan ?? account.plan;

  // Live rate limit data — supported for all providers now
  const isLiveSupported = ["anthropic", "openai", "google"].includes(account.provider);
  const hasLive = liveUsage?.supported === true;
  const fiveH = liveUsage?.five_h;
  const sevenD = liveUsage?.seven_d;
  const isRateLimited = liveUsage?.status === "rate_limited";

  // Determine bar color based on utilization
  function barColor(pct: number): "amber" | "red" {
    if (pct >= 90) return "red";
    return "amber";
  }

  return (
    <div className="group px-3 py-3 border-b border-[#1e2231]/50 last:border-b-0 transition-colors hover:bg-[#1a1d27]/50">
      {/* Header: name, plan badge, delete, check button */}
      <div className="flex items-center gap-2 mb-2.5">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isRateLimited
              ? "bg-red-500 animate-pulse"
              : hasLive
              ? "bg-emerald-500"
              : account.provider === "anthropic"
              ? "bg-amber-400"
              : account.provider === "google"
              ? "bg-blue-400"
              : "bg-emerald-400"
          }`}
        />
        <span className="text-[13px] font-medium text-slate-200">
          {account.name}
        </span>
        {plan && (
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold uppercase tracking-wide border-0 ${
              account.provider === "anthropic"
                ? "bg-amber-500/15 text-amber-400"
                : account.provider === "google"
                ? "bg-blue-500/15 text-blue-400"
                : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {planLabel(plan)}
          </Badge>
        )}
        <span className="flex-1" />
        {isLiveSupported && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCheckLive}
            disabled={checkingLive}
            className={`h-auto px-1.5 py-0.5 text-[10px] ${
              account.provider === "anthropic"
                ? "text-amber-400/70 hover:text-amber-400"
                : account.provider === "google"
                ? "text-blue-400/70 hover:text-blue-400"
                : "text-emerald-400/70 hover:text-emerald-400"
            }`}
            title={account.provider === "openai"
              ? "Check live usage from OpenAI"
              : account.provider === "google"
              ? "Check live usage from Google"
              : "Check live usage (makes a small API call)"
            }
          >
            {checkingLive ? "..." : "Refresh"}
          </Button>
        )}
      </div>

      <div className="ml-4 flex flex-col gap-2.5">
        {/* ── Utilization bars ──────────────────────────────────── */}
        {hasLive && fiveH?.utilization_pct != null && (
          <UsageBar
            pct={fiveH.utilization_pct}
            label={account.provider === "anthropic" ? "5-hour window" : "Primary window"}
            resetLabel={
              fiveH.resets_in_secs != null && fiveH.resets_in_secs > 0
                ? `resets in ${formatDuration(fiveH.resets_in_secs)}`
                : undefined
            }
            color={barColor(fiveH.utilization_pct)}
            windowTotalSecs={5 * 3600}
            resetsInSecs={fiveH.resets_in_secs ?? undefined}
          />
        )}
        {hasLive && sevenD?.utilization_pct != null && (
          <UsageBar
            pct={sevenD.utilization_pct}
            label={account.provider === "anthropic" ? "7-day window" : "Secondary window"}
            resetLabel={
              sevenD.resets_in_secs != null && sevenD.resets_in_secs > 0
                ? `resets in ${formatDuration(sevenD.resets_in_secs)}`
                : undefined
            }
            color={barColor(sevenD.utilization_pct)}
            windowTotalSecs={7 * 24 * 3600}
            resetsInSecs={sevenD.resets_in_secs ?? undefined}
          />
        )}

        {/* Rate limited warning */}
        {isRateLimited && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20">
            <span className="text-red-400 text-[11px] font-semibold">Rate limited</span>
            {fiveH?.resets_in_secs != null && fiveH.resets_in_secs > 0 && (
              <span className="text-[11px] text-red-400/70 tabular-nums">
                resets in {formatDuration(fiveH.resets_in_secs)}
              </span>
            )}
          </div>
        )}

        {/* ── Estimated stats (from local JSONL data) ───────────── */}
        {!isSharedUsage ? (
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-600 tabular-nums">
              {formatTokens(weekTokens)} tokens this week
            </span>
            <span className="text-[10px] text-slate-600 tabular-nums">
              {weekSessions} sessions
            </span>
            {!hasLive && (
              <span className="text-[10px] text-slate-700 italic">local estimates only</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-700 italic">
              local stats shared with other {account.provider === "anthropic" ? "Claude" : "accounts"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Status badge for reviews ────────────────────────────────────────────────

function ReviewStatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    analyzing: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    running: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  const labels: Record<string, string> = {
    pending: "Pending",
    analyzing: "Running",
    running: "Running",
    completed: "Done",
    failed: "Failed",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 ${config[status] ?? "text-slate-500"}`}
    >
      {labels[status] ?? status}
    </Badge>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

// Module-level cache so data persists across tab switches
let _cachedDashboard: {
  stats: IndexStats | null;
  sessions: SessionRow[];
  reviews: LocalReviewRow[];
  agents: AgentProcess[];
  accounts: ProviderAccount[];
  usages: Record<string, AccountUsage>;
  liveUsages: Record<string, LiveUsageResult>;
  fetchedAt: number;
} | null = null;

const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export default function Home() {
  const navigate = useNavigate();
  const isInitialLoad = useRef(true);

  // Data state — initialize from cache if available
  const [stats, setStats] = useState<IndexStats | null>(_cachedDashboard?.stats ?? null);
  const [recentSessions, setRecentSessions] = useState<SessionRow[]>(_cachedDashboard?.sessions ?? []);
  const [recentReviews, setRecentReviews] = useState<LocalReviewRow[]>(_cachedDashboard?.reviews ?? []);
  const [activeAgents, setActiveAgents] = useState<AgentProcess[]>(_cachedDashboard?.agents ?? []);
  const [accounts, setAccounts] = useState<ProviderAccount[]>(_cachedDashboard?.accounts ?? []);
  const [accountUsages, setAccountUsages] = useState<Record<string, AccountUsage>>(_cachedDashboard?.usages ?? {});
  const [liveUsages, setLiveUsages] = useState<Record<string, LiveUsageResult>>(_cachedDashboard?.liveUsages ?? {});
  const [checkingLiveFor, setCheckingLiveFor] = useState<string | null>(null);

  // UI state — skip loading spinner if we have cached data
  const [loading, setLoading] = useState(_cachedDashboard === null);
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<TriggerIndexResult | null>(
    null
  );
  const [showCosts, setShowCosts] = useState(true);

  // ─── Load all dashboard data ────────────────────────────────────────────

  const loadDashboard = useCallback(async (showSpinner: boolean = true) => {
    if (showSpinner) {
      setLoading(true);
    }
    setError(null);

    try {
      // Fire all requests in parallel
      const [statsResult, sessionsResult, reviewsResult, agentsResult, accountsResult] =
        await Promise.allSettled([
          getIndexStats(),
          listSessions(undefined, undefined, 4, 0),
          listReviews(4, 0),
          listAgents(),
          listProviderAccounts(),
        ]);

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
      }
      if (sessionsResult.status === "fulfilled") {
        setRecentSessions(sessionsResult.value);
      }
      if (reviewsResult.status === "fulfilled") {
        setRecentReviews(reviewsResult.value);
      }
      if (agentsResult.status === "fulfilled") {
        setActiveAgents(agentsResult.value);
      }

      // Load accounts — auto-detect if none exist
      if (accountsResult.status === "fulfilled") {
        let accts = accountsResult.value;

        if (accts.length === 0) {
          // Auto-detect on first load
          try {
            const detectResult = await detectProviderAccounts();
            accts = detectResult.accounts;
          } catch {
            // Detection failed, no big deal
          }
        }

        setAccounts(accts);

        // Fetch usage for each account in parallel
        if (accts.length > 0) {
          const usageResults = await Promise.allSettled(
            accts.map((a) => checkAccountUsage(a.id))
          );
          const usageMap: Record<string, AccountUsage> = {};
          usageResults.forEach((r, i) => {
            if (r.status === "fulfilled") {
              usageMap[accts[i].id] = r.value;
            }
          });
          setAccountUsages(usageMap);
        }
      }

      // If all failed, surface the first error
      const allFailed = [
        statsResult,
        sessionsResult,
        reviewsResult,
        agentsResult,
      ].every((r) => r.status === "rejected");
      if (allFailed && statsResult.status === "rejected") {
        const msg =
          statsResult.reason instanceof Error
            ? statsResult.reason.message
            : String(statsResult.reason);
        if (msg === "TAURI_NOT_AVAILABLE") {
          setError(
            "Tauri APIs not available. Run inside the desktop app to see live data."
          );
        } else {
          setError(msg);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      isInitialLoad.current = false;
    }
  }, []);

  // Write state to module-level cache whenever data changes
  useEffect(() => {
    if (loading) return;
    _cachedDashboard = {
      stats,
      sessions: recentSessions,
      reviews: recentReviews,
      agents: activeAgents,
      accounts,
      usages: accountUsages,
      liveUsages,
      fetchedAt: Date.now(),
    };
  }, [loading, stats, recentSessions, recentReviews, activeAgents, accounts, accountUsages, liveUsages]);

  // Refresh without showing loading spinners (for background event updates)
  const refreshDashboard = useCallback(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  // Load cost visibility preference
  useEffect(() => {
    if (!isTauriAvailable()) return;
    getPreference("show_costs").then((v) => {
      if (v !== null) setShowCosts(v === "true");
    }).catch(() => {});
  }, []);

  // Initial load — skip if cache is fresh (< 3 min old)
  useEffect(() => {
    if (_cachedDashboard && Date.now() - _cachedDashboard.fetchedAt < CACHE_TTL_MS) {
      // Cache is fresh, no fetch needed
      return;
    }
    loadDashboard();
  }, [loadDashboard]);

  // ─── Periodic background sync every 3 minutes ──────────────────────────

  useEffect(() => {
    if (!isTauriAvailable()) return;

    const interval = setInterval(() => {
      refreshDashboard();
    }, CACHE_TTL_MS);

    return () => clearInterval(interval);
  }, [refreshDashboard]);

  // ─── Auto-refresh live usage every 60s ─────────────────────────────────

  const refreshLiveUsage = useCallback(async (accts: ProviderAccount[]) => {
    const supported = accts.filter((a) =>
      ["anthropic", "openai", "google"].includes(a.provider)
    );
    if (supported.length === 0) return;

    const results = await Promise.allSettled(
      supported.map((a) => checkLiveUsage(a.provider, a.api_key ?? undefined))
    );
    setLiveUsages((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          next[supported[i].id] = r.value;
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    // Don't start until accounts are loaded
    if (accounts.length === 0) return;

    // Fetch immediately on first load
    refreshLiveUsage(accounts);

    // Then every 60 seconds
    const interval = setInterval(() => {
      refreshLiveUsage(accounts);
    }, 60_000);

    return () => clearInterval(interval);
  }, [accounts, refreshLiveUsage]);

  // ─── Trigger re-index ──────────────────────────────────────────────────

  const handleTriggerIndex = useCallback(async () => {
    setIndexing(true);
    setIndexResult(null);
    try {
      const result = await triggerIndex();
      setIndexResult(result);
      // Refresh dashboard after indexing (no spinners — user sees "Indexing..." state)
      await refreshDashboard();
    } catch (err) {
      console.error("Trigger index failed:", err);
    } finally {
      setIndexing(false);
    }
  }, [refreshDashboard]);

  // ─── Computed values ───────────────────────────────────────────────────

  const runningAgents = activeAgents.filter((a) => a.status === "running");
  const completedReviews = recentReviews.filter(
    (r) => r.status === "completed"
  );

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-slate-100">Overview</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTriggerIndex}
          disabled={indexing}
          className="h-auto px-2.5 py-1 text-[11px] font-medium"
        >
          {indexing ? "Indexing..." : "Re-index"}
        </Button>
      </div>

      {/* Index result banner */}
      {indexResult && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
          <span className="text-emerald-400 text-sm">{"\u2714"}</span>
          <p className="text-xs text-emerald-300">
            Indexed {indexResult.indexed_sessions} sessions and{" "}
            {indexResult.indexed_messages} messages across{" "}
            {indexResult.projects_scanned} projects.
          </p>
          <button
            onClick={() => setIndexResult(null)}
            className="ml-auto text-xs text-emerald-400/50 hover:text-emerald-400"
          >
            {"\u2715"}
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <span className="text-red-400 text-sm">{"\u26A0"}</span>
          <p className="text-xs text-red-300">{error}</p>
          <button
            onClick={() => loadDashboard()}
            className="ml-auto text-xs text-red-400/50 hover:text-red-400"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Active Agents",
            value: loading ? "--" : String(runningAgents.length),
            color: "text-amber-400",
          },
          {
            label: "Reviews",
            value: loading ? "--" : String(completedReviews.length),
            color: "text-emerald-400",
          },
          {
            label: "Sessions",
            value: loading
              ? "--"
              : String(stats?.session_count ?? recentSessions.length),
            color: "text-cyan-400",
          },
          {
            label: "Messages",
            value: loading
              ? "--"
              : stats?.message_count
              ? stats.message_count > 999
                ? `${(stats.message_count / 1000).toFixed(1)}k`
                : String(stats.message_count)
              : "0",
            color: "text-yellow-400",
          },
          ...(showCosts
            ? [
                {
                  label: "Total Cost",
                  value: loading
                    ? "--"
                    : stats?.total_cost_usd != null
                    ? `$${stats.total_cost_usd.toFixed(2)}`
                    : "$0.00",
                  color: "text-rose-400",
                },
              ]
            : []),
          {
            label: "Tokens",
            value: loading
              ? "--"
              : (() => {
                  const total =
                    (stats?.total_input_tokens ?? 0) +
                    (stats?.total_output_tokens ?? 0);
                  if (total === 0) return "0";
                  if (total < 1000) return String(total);
                  if (total < 1_000_000)
                    return `${(total / 1000).toFixed(1)}k`;
                  return `${(total / 1_000_000).toFixed(1)}M`;
                })(),
            color: "text-cyan-400",
          },
        ].map((stat) => (
          <Card
            key={stat.label}
            className="flex items-center justify-between border-[#1e2231] bg-[#0f1117] px-4 py-3"
          >
            <span className="text-[11px] text-slate-500">{stat.label}</span>
            <span className={`text-sm font-semibold tabular-nums ${stat.color}`}>
              {stat.value}
            </span>
          </Card>
        ))}
      </div>

      {/* Usage — remaining per account */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-slate-300">Usage</h2>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1.5 py-0.5 text-[11px] text-slate-500 hover:text-slate-300"
              onClick={async () => {
                try {
                  // Re-detect accounts AND re-index sessions
                  const [result] = await Promise.all([
                    detectProviderAccounts(),
                    triggerIndex(),
                  ]);
                  setAccounts(result.accounts);
                  if (result.accounts.length > 0) {
                    const usageResults = await Promise.allSettled(
                      result.accounts.map((a) => checkAccountUsage(a.id))
                    );
                    const usageMap: Record<string, AccountUsage> = {};
                    usageResults.forEach((r, i) => {
                      if (r.status === "fulfilled") {
                        usageMap[result.accounts[i].id] = r.value;
                      }
                    });
                    setAccountUsages(usageMap);
                  }
                  // Refresh dashboard data after index
                  refreshDashboard();
                } catch (err) {
                  console.error("Detection failed:", err);
                }
              }}
            >
              Re-detect
            </Button>
          </div>
        </div>
        {loading ? (
          <Card className="flex items-center justify-center py-4 border-[#1e2231]">
            <svg className="h-4 w-4 animate-spin text-slate-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </Card>
        ) : (
          <Card className="border-[#1e2231] overflow-hidden">
            {accounts.length === 0 ? (
              <CardContent className="flex flex-col items-center justify-center py-5 p-5">
                <p className="text-[11px] text-slate-600">No CLI accounts detected</p>
                <p className="text-[11px] text-slate-600 mt-0.5">Log into Claude Code, Codex, Cursor, or Gemini to auto-detect</p>
              </CardContent>
            ) : (
              accounts.map((account, idx) => {
                // If multiple accounts share the same provider, only the first shows local stats
                const isFirstOfProvider = accounts.findIndex((a) => a.provider === account.provider) === idx;
                const hasSiblings = accounts.filter((a) => a.provider === account.provider).length > 1;
                return (
                <AccountUsageRow
                  key={account.id}
                  account={account}
                  usage={accountUsages[account.id] ?? null}
                  liveUsage={liveUsages[account.id] ?? null}
                  checkingLive={checkingLiveFor === account.id}
                  isSharedUsage={hasSiblings && !isFirstOfProvider}
                  onCheckLive={async () => {
                    setCheckingLiveFor(account.id);
                    try {
                      const result = await checkLiveUsage(account.provider, account.api_key ?? undefined);
                      setLiveUsages((prev) => ({ ...prev, [account.id]: result }));
                    } catch (err) {
                      console.error("Live usage check failed:", err);
                    } finally {
                      setCheckingLiveFor(null);
                    }
                  }}
                  onDelete={async () => {
                    try {
                      await deleteProviderAccount(account.id);
                      refreshDashboard();
                    } catch (err) {
                      console.error("Failed to delete account:", err);
                    }
                  }}
                />
              );})

            )}
          </Card>
        )}
      </div>

      {/* Two-column layout: Sessions + Reviews */}
      <div className="grid grid-cols-5 gap-5">
        {/* Recent Sessions (3/5 width) */}
        <div className="col-span-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-slate-300">
              Recent Sessions
            </h2>
            <Button variant="link" size="sm" className="h-auto px-0 py-0 text-[11px] text-slate-500 hover:text-slate-300" asChild>
              <Link to="/history">View all</Link>
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <svg
                className="h-4 w-4 animate-spin text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          ) : recentSessions.length === 0 ? (
            <Card className="flex flex-col items-center justify-center py-8 border-[#1e2231]">
              <p className="text-[11px] text-slate-600">No sessions yet</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTriggerIndex}
                className="mt-1 h-auto px-2 py-0.5 text-[11px] text-slate-500 hover:text-slate-300"
              >
                Run indexer
              </Button>
            </Card>
          ) : (
            <Card className="border-[#1e2231] overflow-hidden">
              {recentSessions.map((session) => (
                <div key={session.id} className="border-b border-[#1e2231]/50 last:border-b-0">
                  <SessionCard
                    session={session}
                    onClick={() => navigate(`/sessions?id=${session.id}`)}
                  />
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Reviews (2/5 width) */}
        <div className="col-span-2 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-slate-300">Reviews</h2>
            <Button variant="link" size="sm" className="h-auto px-0 py-0 text-[11px] text-slate-500 hover:text-slate-300" asChild>
              <Link to="/board">New review</Link>
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <svg
                className="h-4 w-4 animate-spin text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          ) : recentReviews.length === 0 ? (
            <Card className="flex flex-col items-center justify-center py-8 border-[#1e2231]">
              <p className="text-[11px] text-slate-600">No reviews yet</p>
              <Button variant="link" size="sm" className="mt-1 h-auto px-0 py-0 text-[11px] text-slate-500 hover:text-slate-300" asChild>
                <Link to="/board">Start a review</Link>
              </Button>
            </Card>
          ) : (
            <Card className="border-[#1e2231] overflow-hidden">
              {recentReviews.map((review) => (
                <div
                  key={review.id}
                  className="flex items-center gap-3 px-3 py-2 border-b border-[#1e2231]/50 last:border-b-0 transition-colors hover:bg-[#1a1d27]"
                >
                  {review.status === "completed" &&
                  review.score_composite != null ? (
                    <ScoreBadge
                      score={Math.round(review.score_composite)}
                      size="sm"
                    />
                  ) : (
                    <span className="text-[10px] text-amber-400">{"\u25CF"}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-slate-300 truncate">
                      {review.source_label || review.repo_path || "Review"}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-600 tabular-nums">
                    {review.findings_count ?? 0}
                  </span>
                  <ReviewStatusBadge status={review.status} />
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Active Agents strip */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-slate-300">
            Agents
          </h2>
          <Button variant="link" size="sm" className="h-auto px-0 py-0 text-[11px] text-slate-500 hover:text-slate-300" asChild>
            <Link to="/board">Mission Control</Link>
          </Button>
        </div>
        <Card className="border-[#1e2231] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <svg
                className="h-4 w-4 animate-spin text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          ) : (
            <>
              {activeAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 px-3 py-2 border-b border-[#1e2231]/50 last:border-b-0 transition-colors hover:bg-[#1a1d27]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      agent.status === "running"
                        ? "bg-emerald-400"
                        : agent.status === "stopped"
                        ? "bg-slate-600"
                        : "bg-yellow-400"
                    }`}
                  />
                  <span className="text-[13px] font-medium text-slate-200 capitalize">
                    {agent.display_name || agent.role || "Agent"}
                  </span>
                  <span className="text-[11px] text-slate-600 uppercase">
                    {agent.agent_type}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11px] text-slate-500 truncate max-w-[160px] font-mono">
                    {agent.project_path?.split("/").pop() || ""}
                  </span>
                  {showCosts && agent.estimated_cost_usd > 0 && (
                    <span className="text-[11px] text-rose-400/70 tabular-nums">
                      ${agent.estimated_cost_usd.toFixed(2)}
                    </span>
                  )}
                </div>
              ))}

              <Link
                to="/board"
                className="flex items-center gap-2 px-3 py-2 text-slate-600 transition-colors hover:bg-[#1a1d27] hover:text-slate-400"
              >
                <span className="text-sm">+</span>
                <span className="text-[11px] font-medium">Launch Agent</span>
              </Link>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
