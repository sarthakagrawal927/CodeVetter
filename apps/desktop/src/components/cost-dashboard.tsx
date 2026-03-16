import { useState, useEffect } from "react";
import {
  getCostDashboard,
  isTauriAvailable,
} from "@/lib/tauri-ipc";
import type { CostDashboardData, AgentCostSummary } from "@/lib/tauri-ipc";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function CostBar({ agent, maxCost }: { agent: AgentCostSummary; maxCost: number }) {
  const pct = maxCost > 0 ? (agent.total_cost_usd / maxCost) * 100 : 0;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-28 shrink-0">
        <p className="text-xs font-medium text-slate-300 truncate">
          {agent.display_name ?? agent.agent_id.slice(0, 8)}
        </p>
        <p className="text-[10px] text-slate-600">{agent.agent_type}</p>
      </div>
      <div className="flex-1">
        <div className="h-3 rounded-full bg-[#1e2231] overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-500/60 transition-all duration-500"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
      <div className="w-20 text-right">
        <span className="text-xs font-medium text-slate-300">
          ${agent.total_cost_usd.toFixed(4)}
        </span>
      </div>
    </div>
  );
}

export default function CostDashboard() {
  const [data, setData] = useState<CostDashboardData | null>(null);

  useEffect(() => {
    if (!isTauriAvailable()) return;
    getCostDashboard().then(setData).catch(() => {});

    const interval = setInterval(() => {
      getCostDashboard().then(setData).catch(() => {});
    }, 10_000);

    return () => clearInterval(interval);
  }, []);

  if (!data) {
    return (
      <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-6">
        <p className="text-xs text-slate-600">Loading cost data...</p>
      </div>
    );
  }

  const maxCost = Math.max(...data.agents.map((a) => a.total_cost_usd), 0.01);

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Total Spend
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100">
            ${data.total_cost_usd.toFixed(4)}
          </p>
        </div>
        <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Input Tokens
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100">
            {formatTokens(data.total_input_tokens)}
          </p>
        </div>
        <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-4">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            Output Tokens
          </p>
          <p className="mt-1 text-xl font-bold text-slate-100">
            {formatTokens(data.total_output_tokens)}
          </p>
        </div>
      </div>

      {/* Per-agent breakdown */}
      <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Cost by Agent
        </h3>
        {data.agents.length === 0 ? (
          <p className="text-xs text-slate-600 py-4 text-center">
            No cost data yet. Launch agents to see spend tracking.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[#1e2231]">
            {data.agents.map((agent) => (
              <CostBar key={agent.agent_id} agent={agent} maxCost={maxCost} />
            ))}
          </div>
        )}
      </div>

      {/* Token detail table */}
      {data.agents.length > 0 && (
        <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Token Breakdown
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="pb-2">Agent</th>
                <th className="pb-2 text-right">Input</th>
                <th className="pb-2 text-right">Output</th>
                <th className="pb-2 text-right">Cost</th>
                <th className="pb-2 text-right">Entries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2231]">
              {data.agents.map((a) => (
                <tr key={a.agent_id}>
                  <td className="py-2 text-slate-300">
                    {a.display_name ?? a.agent_id.slice(0, 8)}
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    {formatTokens(a.total_input_tokens)}
                  </td>
                  <td className="py-2 text-right text-slate-400">
                    {formatTokens(a.total_output_tokens)}
                  </td>
                  <td className="py-2 text-right text-slate-300">
                    ${a.total_cost_usd.toFixed(4)}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {a.entry_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
