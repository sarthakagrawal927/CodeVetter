import { useState, useEffect, useCallback, useRef } from "react";
import AgentCard from "@/components/agent-card";
import KanbanBoard from "@/components/kanban-board";
import ChatViewer from "@/components/chat-viewer";
import DirectoryPicker from "@/components/directory-picker";
import ReviewForm from "@/components/review-form";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listAgents,
  launchAgent,
  stopAgent,
  listTasks,
  createTask,
  updateTask,
  listActivity,
  listAgentPresets,
  createAgentPreset,
  deleteAgentPreset,
  getSession,
  isTauriAvailable,
  onAgentStatusChanged,
  onActivityUpdate,
  checkLinearConnection,
  listLinearIssues,
  importLinearIssues,
  listSessions,
  startLocalReview,
  startPrReview,
  generatePlaywrightTest,
  listAgentPersonas,
  createAgentPersona,
  updateAgentPersona,
  deleteAgentPersona,
  getPreference,
} from "@/lib/tauri-ipc";
import type { AgentProcess, Task, ActivityEvent, AgentPreset, AgentPersona, LinearIssue, SessionRow, MessageRow, ReviewTone } from "@/lib/tauri-ipc";
import { startReviewLoop, continueReviewLoop, getAllActiveLoops, type LoopState } from "@/lib/review-loop";

// ─── Create Task Modal ──────────────────────────────────────────────────────

function CreateTaskPanel({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, description: string, criteria: string, projectPath: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");
  const [projectPath, setProjectPath] = useState("");

  const inputClass =
    "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5 fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">New Task</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">
          {"\u2715"}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className={inputClass}
        />
        <DirectoryPicker
          value={projectPath}
          onChange={setProjectPath}
          label="Project Directory"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={2}
          className={`resize-none ${inputClass}`}
        />
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder="Acceptance criteria (optional)"
          rows={2}
          className={`resize-none ${inputClass}`}
        />
        <button
          onClick={() => {
            if (title.trim()) onCreate(title, description, criteria, projectPath);
          }}
          disabled={!title.trim()}
          className="self-start rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}

// ─── Launch Agent Form ───────────────────────────────────────────────────────

const CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"];
const CODEX_MODELS = ["gpt-4.1", "o3", "o4-mini"];
const CODEX_APPROVAL_MODES = ["suggest", "auto-edit", "full-auto"];
const OUTPUT_FORMATS = ["text", "json", "stream-json"];

function LaunchAgentForm({
  onClose,
  onLaunch,
  presets,
  onPresetsChanged,
}: {
  onClose: () => void;
  onLaunch: (adapter: string, path: string, role: string, task: string) => void;
  presets: AgentPreset[];
  onPresetsChanged: () => void;
}) {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [adapter, setAdapter] = useState<"claude-code" | "codex">("claude-code");
  const [path, setPath] = useState("");
  const [role, setRole] = useState("coder");
  const [task, setTask] = useState("");

  // Claude Code options
  const [claudeModel, setClaudeModel] = useState(CLAUDE_MODELS[0]);
  const [maxTurns, setMaxTurns] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [printMode, setPrintMode] = useState(false);
  const [noSessionPersist, setNoSessionPersist] = useState(false);
  const [outputFormat, setOutputFormat] = useState("text");

  // Codex options
  const [codexModel, setCodexModel] = useState(CODEX_MODELS[0]);
  const [approvalMode, setApprovalMode] = useState("suggest");
  const [quietMode, setQuietMode] = useState(false);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  function applyPreset(preset: AgentPreset) {
    setSelectedPresetId(preset.id);
    setAdapter(preset.adapter as "claude-code" | "codex");
    setRole(preset.role || "coder");
    setSystemPrompt(preset.system_prompt || "");
    setAllowedTools(preset.allowed_tools || "");
    setMaxTurns(preset.max_turns ? String(preset.max_turns) : "");
    setOutputFormat(preset.output_format || "text");
    setPrintMode(preset.print_mode === 1);
    setNoSessionPersist(preset.no_session_persist === 1);
    setApprovalMode(preset.approval_mode || "suggest");
    setQuietMode(preset.quiet_mode === 1);

    if (preset.adapter === "claude-code" && preset.model) {
      setClaudeModel(preset.model);
    } else if (preset.adapter === "codex" && preset.model) {
      setCodexModel(preset.model);
    }
  }

  function clearPreset() {
    setSelectedPresetId(null);
    setAdapter("claude-code");
    setRole("coder");
    setSystemPrompt("");
    setAllowedTools("");
    setMaxTurns("");
    setOutputFormat("text");
    setPrintMode(false);
    setNoSessionPersist(false);
    setClaudeModel(CLAUDE_MODELS[0]);
    setCodexModel(CODEX_MODELS[0]);
    setApprovalMode("suggest");
    setQuietMode(false);
  }

  async function handleSavePreset() {
    if (!presetName.trim()) return;
    setSavingPreset(true);
    try {
      await createAgentPreset({
        name: presetName.trim(),
        adapter,
        role: role || undefined,
        systemPrompt: systemPrompt || undefined,
        model: adapter === "claude-code" ? claudeModel : codexModel,
        maxTurns: maxTurns ? parseInt(maxTurns) : undefined,
        allowedTools: allowedTools || undefined,
        outputFormat: outputFormat !== "text" ? outputFormat : undefined,
        printMode,
        noSessionPersist,
        approvalMode: adapter === "codex" ? approvalMode : undefined,
        quietMode,
      });
      setShowSavePreset(false);
      setPresetName("");
      onPresetsChanged();
    } catch (err) {
      console.error("Failed to save preset:", err);
    } finally {
      setSavingPreset(false);
    }
  }

  async function handleDeletePreset(presetId: string) {
    try {
      await deleteAgentPreset(presetId);
      if (selectedPresetId === presetId) clearPreset();
      onPresetsChanged();
    } catch (err) {
      console.error("Failed to delete preset:", err);
    }
  }

  const inputClass =
    "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";
  const selectClass =
    "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 outline-none focus:border-amber-500/50 appearance-none";
  const labelClass = "text-xs font-medium text-slate-300";
  const checkboxRowClass = "flex items-center gap-2";

  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5 fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Launch Agent</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">
          {"\u2715"}
        </button>
      </div>

      <div className="flex flex-col gap-4">
        {/* Preset selector */}
        {presets.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Preset</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={clearPreset}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedPresetId === null
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-[#1e2231] text-slate-400 hover:border-[#2d3348]"
                }`}
              >
                Custom
              </button>
              {presets.map((p) => (
                <div key={p.id} className="group relative">
                  <button
                    onClick={() => applyPreset(p)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedPresetId === p.id
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                        : "border-[#1e2231] text-slate-400 hover:border-[#2d3348]"
                    }`}
                  >
                    {p.name}
                    <span className="ml-1.5 text-[10px] text-slate-600">
                      {p.adapter === "claude-code" ? "CC" : "CX"}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePreset(p.id);
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-[#1e2231] px-1 text-[10px] text-slate-500 hover:text-red-400 group-hover:block"
                    title="Delete preset"
                  >
                    {"\u2715"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Adapter */}
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Adapter</label>
          <div className="flex gap-2">
            {(["claude-code", "codex"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAdapter(a)}
                className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                  adapter === a
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-[#1e2231] text-slate-400 hover:border-[#2d3348]"
                }`}
              >
                {a === "claude-code" ? "Claude Code" : "Codex"}
              </button>
            ))}
          </div>
        </div>

        {/* Project path */}
        <DirectoryPicker
          value={path}
          onChange={setPath}
          label="Project Path"
        />

        {/* Role */}
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Role</label>
          <div className="flex gap-2 flex-wrap">
            {["coder", "reviewer", "planner", "debugger"].map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  role === r
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-[#1e2231] text-slate-400 hover:border-[#2d3348]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Task */}
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Initial Task (optional)</label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what this agent should work on..."
            rows={3}
            className={`resize-none ${inputClass}`}
          />
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors self-start"
        >
          <svg
            className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
          CLI Options
        </button>

        {/* Advanced CLI Options */}
        {showAdvanced && (
          <div className="flex flex-col gap-3 rounded-lg border border-[#1e2231] bg-[#0f1117] p-4">
            {adapter === "claude-code" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Model</label>
                  <select
                    value={claudeModel}
                    onChange={(e) => setClaudeModel(e.target.value)}
                    className={selectClass}
                  >
                    {CLAUDE_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Max Turns</label>
                  <input
                    type="number"
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(e.target.value)}
                    placeholder="Unlimited"
                    min={1}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Allowed Tools (comma-separated)</label>
                  <input
                    type="text"
                    value={allowedTools}
                    onChange={(e) => setAllowedTools(e.target.value)}
                    placeholder="e.g. Read,Write,Bash"
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>System Prompt</label>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Custom system prompt..."
                    rows={2}
                    className={`resize-none ${inputClass}`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Output Format</label>
                  <select
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value)}
                    className={selectClass}
                  >
                    {OUTPUT_FORMATS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2 mt-1">
                  <label className={checkboxRowClass}>
                    <input
                      type="checkbox"
                      checked={printMode}
                      onChange={(e) => setPrintMode(e.target.checked)}
                      className="rounded border-[#1e2231] bg-[#0f1117] text-amber-500 focus:ring-amber-500/30"
                    />
                    <span className="text-xs text-slate-300">Print mode (--print)</span>
                  </label>
                  <label className={checkboxRowClass}>
                    <input
                      type="checkbox"
                      checked={noSessionPersist}
                      onChange={(e) => setNoSessionPersist(e.target.checked)}
                      className="rounded border-[#1e2231] bg-[#0f1117] text-amber-500 focus:ring-amber-500/30"
                    />
                    <span className="text-xs text-slate-300">No session persistence</span>
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Model</label>
                  <select
                    value={codexModel}
                    onChange={(e) => setCodexModel(e.target.value)}
                    className={selectClass}
                  >
                    {CODEX_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Approval Mode</label>
                  <select
                    value={approvalMode}
                    onChange={(e) => setApprovalMode(e.target.value)}
                    className={selectClass}
                  >
                    {CODEX_APPROVAL_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2 mt-1">
                  <label className={checkboxRowClass}>
                    <input
                      type="checkbox"
                      checked={quietMode}
                      onChange={(e) => setQuietMode(e.target.checked)}
                      className="rounded border-[#1e2231] bg-[#0f1117] text-amber-500 focus:ring-amber-500/30"
                    />
                    <span className="text-xs text-slate-300">Quiet mode</span>
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (path.trim()) onLaunch(adapter, path, role, task);
            }}
            disabled={!path.trim()}
            className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            Launch
          </button>

          {!showSavePreset && (
            <button
              onClick={() => setShowSavePreset(true)}
              className="rounded-lg border border-[#1e2231] px-3 py-2 text-xs text-slate-400 transition-colors hover:border-[#2d3348] hover:text-slate-200"
            >
              Save as Preset
            </button>
          )}
        </div>

        {/* Save preset inline */}
        {showSavePreset && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name..."
              className={`flex-1 ${inputClass}`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePreset();
                if (e.key === "Escape") setShowSavePreset(false);
              }}
            />
            <button
              onClick={handleSavePreset}
              disabled={!presetName.trim() || savingPreset}
              className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setShowSavePreset(false)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Import from Linear Modal ────────────────────────────────────────────────

const PRIORITY_COLORS: Record<number, string> = {
  0: "text-slate-500",   // No priority
  1: "text-red-400",     // Urgent
  2: "text-orange-400",  // High
  3: "text-yellow-400",  // Medium
  4: "text-slate-400",   // Low
};

function ImportLinearModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchIssues() {
      try {
        const result = await listLinearIssues();
        setIssues(result.issues);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchIssues();
  }, []);

  function toggleIssue(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === issues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(issues.map((i) => i.id)));
    }
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      await importLinearIssues(Array.from(selected));
      onImported();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5 fade-in w-full max-w-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Import from Linear</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">
          {"\u2715"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#5E6AD2] border-t-transparent" />
          <span className="ml-2 text-sm text-slate-400">Loading issues...</span>
        </div>
      ) : issues.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No assigned issues found in Linear.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={toggleAll}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
            >
              {selected.size === issues.length ? "Deselect all" : "Select all"}
            </button>
            <span className="text-xs text-slate-500">
              {selected.size} of {issues.length} selected
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-[#1e2231] bg-[#0f1117]">
            {issues.map((issue) => (
              <label
                key={issue.id}
                className="flex items-start gap-3 px-3 py-2.5 border-b border-[#1e2231] last:border-b-0 cursor-pointer hover:bg-[#1a1d27] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(issue.id)}
                  onChange={() => toggleIssue(issue.id)}
                  className="mt-0.5 rounded border-[#1e2231] bg-[#0f1117] text-amber-500 focus:ring-amber-500/30"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-500">{issue.identifier}</span>
                    <span className={`text-[10px] font-medium ${PRIORITY_COLORS[issue.priority] ?? "text-slate-500"}`}>
                      {issue.priorityLabel}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 truncate">{issue.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-600">{issue.teamName}</span>
                    <span className="text-[10px] text-slate-600">{issue.stateName}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="mt-3 rounded-md bg-red-500/5 border border-red-500/20 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#1e2231] px-4 py-2 text-sm text-slate-400 transition-colors hover:border-[#2d3348] hover:text-slate-200"
        >
          Cancel
        </button>
        <button
          onClick={handleImport}
          disabled={selected.size === 0 || importing}
          className="rounded-lg bg-[#5E6AD2] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4C5ABF] disabled:opacity-50"
        >
          {importing ? "Importing..." : `Import ${selected.size > 0 ? `(${selected.size})` : ""}`}
        </button>
      </div>
    </div>
  );
}

// ─── Review Modal ─────────────────────────────────────────────────────────────

function ReviewModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmitLocal(repoPath: string, diffRange: string, tone: ReviewTone) {
    setIsLoading(true);
    setError(null);
    try {
      await startLocalReview(repoPath, diffRange, tone);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmitPr(owner: string, repo: string, prNumber: number, tone: ReviewTone) {
    setIsLoading(true);
    setError(null);
    try {
      await startPrReview(owner, repo, prNumber, tone);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5 fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Start Review</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">
          {"\u2715"}
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      <ReviewForm
        onSubmitLocal={handleSubmitLocal}
        onSubmitPr={handleSubmitPr}
        isLoading={isLoading}
      />
    </div>
  );
}

// ─── Test Gen Modal ──────────────────────────────────────────────────────────

function TestGenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

  async function handleGenerate() {
    if (!url.trim() || !description.trim()) {
      setError("URL and description are required");
      return;
    }
    try {
      new URL(url.startsWith("http") ? url : `https://${url}`);
    } catch {
      setError("Invalid URL format");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await generatePlaywrightTest(
        url.startsWith("http") ? url : `https://${url}`,
        description,
        projectPath || undefined,
      );
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-5 fade-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-200">Generate Test</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm">
          {"\u2715"}
        </button>
      </div>
      {error && (
        <div className="mb-4 rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">What to test</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Test that the login flow works..."
            rows={3}
            className={`resize-none ${inputClass}`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-300">
            Project directory{" "}
            <span className="text-slate-600 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="/path/to/project"
            className={inputClass}
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={isLoading || !url.trim() || !description.trim()}
          className="self-start rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
        >
          {isLoading ? "Generating..." : "Generate Test"}
        </button>
      </div>
    </div>
  );
}

// ─── Persona Modal (Create / Edit) ──────────────────────────────────────────

const PERSONA_COLORS = ["amber", "blue", "purple", "green", "red", "slate"] as const;
const PERSONA_COLOR_HEX: Record<string, string> = {
  amber: "#f59e0b",
  blue: "#3b82f6",
  purple: "#a855f7",
  green: "#22c55e",
  red: "#ef4444",
  slate: "#64748b",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function PersonaModal({
  existingPersona,
  existingDepartments,
  onClose,
  onSaved,
}: {
  existingPersona?: AgentPersona;
  existingDepartments: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existingPersona;
  const [department, setDepartment] = useState(existingPersona?.department ?? "");
  const [name, setName] = useState(existingPersona?.name ?? "");
  const [description, setDescription] = useState(existingPersona?.description ?? "");
  const [color, setColor] = useState(existingPersona?.color ?? "amber");
  const [tools, setTools] = useState(existingPersona?.tools.join(", ") ?? "");
  const [systemPrompt, setSystemPrompt] = useState(existingPersona?.system_prompt ?? "");
  const [saving, setSaving] = useState(false);

  const id = existingPersona?.id ?? slugify(name);

  const inputClass =
    "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

  async function handleSave() {
    if (!name.trim() || !department.trim()) return;
    setSaving(true);
    try {
      if (isEdit && existingPersona) {
        await updateAgentPersona(existingPersona.department, existingPersona.id, {
          name,
          description,
          color,
          tools,
          systemPrompt,
        });
      } else {
        await createAgentPersona(department, id, name, description, color, tools, systemPrompt);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error("Failed to save persona:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#1e2231] bg-[#13151c] p-6 shadow-2xl">
      <h2 className="text-base font-semibold text-slate-100 mb-4">
        {isEdit ? "Edit Persona" : "Create Persona"}
      </h2>
      <div className="flex flex-col gap-3">
        {/* Department */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Department</label>
          {isEdit ? (
            <input
              value={department}
              disabled
              className={inputClass + " opacity-50 cursor-not-allowed w-full"}
            />
          ) : (
            <div className="flex gap-2">
              <input
                list="dept-suggestions"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. engineering"
                className={inputClass + " flex-1"}
              />
              <datalist id="dept-suggestions">
                {existingDepartments.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Backend Architect"
            className={inputClass + " w-full"}
          />
          {!isEdit && name && (
            <p className="text-[10px] text-slate-600 mt-1">ID: {slugify(name)}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line description"
            className={inputClass + " w-full"}
          />
        </div>

        {/* Color */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Color</label>
          <div className="flex gap-2">
            {PERSONA_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="h-6 w-6 rounded-full transition-all"
                style={{
                  backgroundColor: PERSONA_COLOR_HEX[c],
                  boxShadow: color === c ? `0 0 0 2px #13151c, 0 0 0 4px ${PERSONA_COLOR_HEX[c]}` : "none",
                }}
                title={c}
              />
            ))}
          </div>
        </div>

        {/* Tools */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Tools (comma-separated)</label>
          <input
            value={tools}
            onChange={(e) => setTools(e.target.value)}
            placeholder="e.g. Read, Edit, Bash"
            className={inputClass + " w-full"}
          />
        </div>

        {/* System Prompt */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">System Prompt</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Instructions for this agent persona..."
            className={inputClass + " w-full min-h-[200px] font-mono text-[12px] resize-y"}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#1e2231] px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !department.trim() || saving}
            className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? "Saving..." : isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Compact Persona Card (left panel) ───────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

function CompactPersonaCard({
  persona,
  busyAgent,
  selected,
  onClick,
  onEdit,
  onDelete,
}: {
  persona: AgentPersona;
  busyAgent: AgentProcess | null;
  selected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isBusy = busyAgent !== null && busyAgent.status === "running";
  const accentColor = COLOR_MAP[persona.color] || "#f59e0b";

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card
            className={`group relative w-full cursor-pointer p-3 transition-colors overflow-hidden ${
              selected
                ? "border-amber-500/30 bg-amber-500/5"
                : "bg-[#13151c] hover:border-[#2d3348]"
            }`}
            style={{ borderLeftColor: accentColor, borderLeftWidth: 2 }}
            onClick={onClick}
          >
            {/* Edit / Delete icons — visible on hover */}
            <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-slate-500 hover:text-slate-300"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                title="Edit persona"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-slate-500 hover:text-red-400"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete persona"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: accentColor }}
              />
              <p className="text-[13px] font-medium text-slate-200 truncate pr-10">
                {persona.name}
              </p>
            </div>
            <p className="text-[11px] text-slate-500 truncate mt-0.5 ml-4">
              {persona.description ? persona.description.split("\\n")[0] : "No description"}
            </p>
            {isBusy && (
              <div className="flex items-center gap-1.5 mt-1.5 ml-4">
                <Badge variant="outline" className="h-5 border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] px-1.5 py-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse mr-1" />
                  running
                </Badge>
              </div>
            )}
          </Card>
        </TooltipTrigger>
        {persona.description && (
          <TooltipContent side="right" className="max-w-xs text-xs">
            {persona.description}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Persona Detail Panel (right panel) ──────────────────────────────────────

function PersonaDetailPanel({
  persona,
  busyAgent,
  onBack,
  onAssign,
  onViewAgent,
}: {
  persona: AgentPersona;
  busyAgent: AgentProcess | null;
  onBack: () => void;
  onAssign: (task: string, projectPath: string) => void;
  onViewAgent: (agentId: string) => void;
}) {
  const [task, setTask] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const isBusy = busyAgent !== null && busyAgent.status === "running";
  const accentColor = COLOR_MAP[persona.color] || "#f59e0b";

  const inputClass =
    "rounded-lg border border-[#1e2231] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50";

  // If persona is busy, redirect to agent conversation view
  if (isBusy) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-300 transition-colors mb-6 self-start"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Board
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div
            className="h-8 w-1 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{persona.name}</h2>
            <p className="text-[12px] text-slate-500">
              {persona.department.replace(/-/g, " ")}
            </p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            Running
          </span>
        </div>

        <p className="text-sm text-slate-400 mb-6">
          This agent is currently working. View the live conversation below.
        </p>

        <button
          onClick={() => onViewAgent(busyAgent.id)}
          className="self-start rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
        >
          View Conversation
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-300 transition-colors mb-6 self-start"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to Board
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div
          className="h-8 w-1 rounded-full"
          style={{ backgroundColor: accentColor }}
        />
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{persona.name}</h2>
          <p className="text-[12px] text-slate-500">
            {persona.department.replace(/-/g, " ")} &middot; {persona.color}
          </p>
        </div>
      </div>

      {persona.description && (
        <p className="text-sm text-slate-400 mb-4 leading-relaxed">
          {persona.description}
        </p>
      )}

      {persona.tools.length > 0 && (
        <div className="mb-6">
          <span className="text-[11px] text-slate-500">Tools: </span>
          <span className="text-[11px] text-slate-300">
            {persona.tools.join(", ")}
          </span>
        </div>
      )}

      <div className="rounded-lg border border-[#1e2231] bg-[#0f1117] p-4">
        <h3 className="text-[12px] font-medium text-slate-300 mb-3">Assign Task</h3>
        <div className="flex flex-col gap-3">
          <DirectoryPicker
            value={projectPath}
            onChange={setProjectPath}
            label="Project Directory"
          />
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what this agent should work on..."
            rows={4}
            className={`resize-none ${inputClass}`}
            autoFocus
          />
          <button
            onClick={() => {
              if (task.trim() && projectPath.trim()) onAssign(task, projectPath);
            }}
            disabled={!task.trim() || !projectPath.trim()}
            className="self-start rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            Launch Agent
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Agents() {
  const [agents, setAgents] = useState<AgentProcess[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [_activity, setActivity] = useState<ActivityEvent[]>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<AgentPersona | null>(null);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState<AgentPersona | undefined>(undefined);
  const [showLaunchPanel, setShowLaunchPanel] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showLinearImport, setShowLinearImport] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showTestGenModal, setShowTestGenModal] = useState(false);
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);
  const [pendingAssignTask, setPendingAssignTask] = useState<Task | null>(null);
  const [linearConnected, setLinearConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loopStates, setLoopStates] = useState<Map<string, LoopState>>(new Map());
  const [maxConcurrent, setMaxConcurrent] = useState(3);

  // Agent conversation panel state
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentSession, setAgentSession] = useState<SessionRow | null>(null);
  const [agentMessages, setAgentMessages] = useState<MessageRow[]>([]);
  const [agentMessagesLoading, setAgentMessagesLoading] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Determine right panel mode
  type RightPanelMode = "kanban" | "persona-detail" | "agent-conversation";
  const rightPanelMode: RightPanelMode = selectedAgentId
    ? "agent-conversation"
    : selectedPersona
      ? "persona-detail"
      : "kanban";

  const loadPresets = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const list = await listAgentPresets();
      setPresets(list);
    } catch (err) {
      console.error("Failed to load presets:", err);
    }
  }, []);

  const loadPersonas = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const result = await listAgentPersonas();
      setPersonas(result.personas);
    } catch (err) {
      console.error("Failed to load personas:", err);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const [agentList, taskList, activityList] = await Promise.all([
        listAgents(),
        listTasks(),
        listActivity(undefined, 50),
      ]);
      setAgents(agentList);
      setTasks(taskList);
      setActivity(activityList);
    } catch (err) {
      console.error("Failed to refresh data:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
    loadPresets();
    loadPersonas();

    // Check Linear connection status (non-blocking)
    if (isTauriAvailable()) {
      checkLinearConnection()
        .then((result) => setLinearConnected(result.connected))
        .catch(() => setLinearConnected(false));

      // Load max_concurrent_agents preference
      getPreference("max_concurrent_agents")
        .then((val) => { if (val) setMaxConcurrent(parseInt(val, 10) || 3); })
        .catch(() => {});
    }

    const interval = setInterval(refresh, 5000);

    let unlistenStatus: (() => void) | undefined;
    let unlistenActivity: (() => void) | undefined;
    if (isTauriAvailable()) {
      onAgentStatusChanged(() => {
        refresh();
      }).then((fn) => {
        unlistenStatus = fn;
      });
      onActivityUpdate(() => {
        refresh();
      }).then((fn) => {
        unlistenActivity = fn;
      });
    }

    return () => {
      clearInterval(interval);
      unlistenStatus?.();
      unlistenActivity?.();
    };
  }, [refresh, loadPresets, loadPersonas]);

  // ─── Review feedback loop ─────────────────────────────────────────────────

  const handleLoopStateChange = useCallback((state: LoopState) => {
    setLoopStates(prev => {
      const next = new Map(prev);
      next.set(state.taskId, state);
      return next;
    });
    refresh();
  }, [refresh]);

  useEffect(() => {
    for (const task of tasks) {
      if (task.status === "in_review" && task.project_path) {
        const existing = loopStates.get(task.id);
        if (!existing || existing.status === "waiting_for_fix") {
          if (existing?.status === "waiting_for_fix") {
            continueReviewLoop(task, handleLoopStateChange);
          } else if (!existing) {
            startReviewLoop(task, handleLoopStateChange);
          }
        }
      }
    }
  }, [tasks]); // intentionally sparse deps — only trigger on task list changes

  // ─── Load agent conversation when selected ──────────────────────────────

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const loadAgentSession = useCallback(async (sessionId: string) => {
    try {
      const result = await getSession(sessionId);
      setAgentSession(result.session);
      setAgentMessages(result.messages);
    } catch (err) {
      console.error("Failed to load agent session:", err);
    }
  }, []);

  useEffect(() => {
    // Clean up previous polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (!selectedAgent) {
      setAgentSession(null);
      setAgentMessages([]);
      setAgentMessagesLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      let sessionId = selectedAgent.session_id;

      // If no session_id stored, try to find a matching session by project path + agent_type
      if (!sessionId && selectedAgent.project_path && isTauriAvailable()) {
        setAgentMessagesLoading(true);
        try {
          const result = await listSessions(undefined, selectedAgent.project_path, 20, 0);
          if (cancelled) return;
          const agentStart = selectedAgent.started_at ? new Date(selectedAgent.started_at).getTime() : 0;

          // Prefer: same agent_type + close start time
          const match = result.find((s: SessionRow) => {
            if (s.agent_type !== selectedAgent.agent_type) return false;
            const sessionStart = s.first_message ? new Date(s.first_message).getTime() : 0;
            return Math.abs(sessionStart - agentStart) < 120000;
          });

          // Fallback: same agent_type, most recent session (sorted by file_mtime desc)
          const fallback = !match
            ? result
                .filter((s: SessionRow) => s.agent_type === selectedAgent.agent_type)
                .sort((a, b) => {
                  const ta = a.file_mtime ? new Date(a.file_mtime).getTime() : 0;
                  const tb = b.file_mtime ? new Date(b.file_mtime).getTime() : 0;
                  return tb - ta;
                })[0]
            : undefined;

          if (match) {
            sessionId = match.id;
          } else if (fallback) {
            sessionId = fallback.id;
          }
        } catch {
          // ignore
        }
      }

      if (cancelled) return;

      if (!sessionId) {
        setAgentSession(null);
        setAgentMessages([]);
        setAgentMessagesLoading(false);
        return;
      }

      // Initial load
      setAgentMessagesLoading(true);
      await loadAgentSession(sessionId);
      if (!cancelled) setAgentMessagesLoading(false);

      // Poll every 5s if agent is running
      if (!cancelled && selectedAgent.status === "running" && sessionId) {
        pollIntervalRef.current = setInterval(() => {
          loadAgentSession(sessionId!);
        }, 5000);
      }
    })();

    return () => {
      cancelled = true;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [selectedAgentId, selectedAgent?.session_id, selectedAgent?.status, loadAgentSession]);

  async function handleLaunch(
    adapter: string,
    path: string,
    role: string,
    task: string
  ) {
    try {
      setError(null);
      await launchAgent(adapter, path, role || undefined, task || undefined);
      setShowLaunchPanel(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStopAgent(id: string) {
    try {
      setError(null);
      await stopAgent(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCreateTask(
    title: string,
    description: string,
    criteria: string,
    projectPath: string
  ) {
    try {
      setError(null);
      await createTask(title, description, criteria || undefined, projectPath || undefined);
      setShowCreateTask(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAssignPersona(persona: AgentPersona, taskDesc: string, projectPath: string, existingTaskId?: string) {
    try {
      setError(null);
      const fullTask = `You are a ${persona.name}. ${persona.system_prompt}\n\nTask: ${taskDesc}`;
      await launchAgent("claude-code", projectPath, persona.name, fullTask);

      if (existingTaskId) {
        // Assign agent to existing task
        await updateTask(existingTaskId, "in_progress", persona.name).catch(() => {});
      }
      // No existingTaskId = launched from squad card — agent runs without a kanban task.
      // User can create a task separately if they want to track it.

      setSelectedPersona(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleEditPersona(persona: AgentPersona) {
    setEditingPersona(persona);
    setShowPersonaModal(true);
  }

  async function handleDeletePersona(persona: AgentPersona) {
    try {
      setError(null);
      await deleteAgentPersona(persona.department, persona.id);
      if (selectedPersona?.id === persona.id) setSelectedPersona(null);
      loadPersonas();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Group personas by department
  const personasByDepartment = personas.reduce<Record<string, AgentPersona[]>>((acc, p) => {
    if (!acc[p.department]) acc[p.department] = [];
    acc[p.department].push(p);
    return acc;
  }, {});

  // Match running agents to personas by role name
  function getBusyAgentForPersona(persona: AgentPersona): AgentProcess | null {
    return agents.find(
      (a) => a.status === "running" && a.role === persona.name
    ) ?? null;
  }

  function handleTaskClick(task: Task) {
    // If task has an assigned agent, find and show its conversation
    if (task.assigned_agent) {
      const matchingAgent = agents.find(
        (a) => a.role === task.assigned_agent || a.id === task.assigned_agent
      );
      if (matchingAgent) {
        setSelectedPersona(null);
        setSelectedAgentId(matchingAgent.id);
        return;
      }
    }
    // No agent — offer to assign one
    setPendingAssignTask(task);
    setShowPersonaPicker(true);
  }

  function handleAddTask(column: string) {
    // Close any open modals first
    setShowLaunchPanel(false);
    setShowLinearImport(false);
    setShowCreateTask(false);
    setShowReviewModal(false);
    setShowTestGenModal(false);

    if (column === "in_review") {
      setShowReviewModal(true);
    } else if (column === "in_test") {
      setShowTestGenModal(true);
    } else {
      // Backlog, In Progress, Done — open generic create task modal
      setShowCreateTask(true);
    }
  }

  return (
    <div className="flex h-full">
      {/* Left sidebar - Agent Squad (always visible) */}
      <div className="w-60 shrink-0 border-r border-[#1e2231] flex flex-col overflow-hidden">
        <div className="border-b border-[#1e2231] px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Agent Squad
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {personas.length === 0 ? (
            <div className="flex flex-col gap-3">
              {/* Fallback: show flat agent cards when no personas loaded */}
              {agents.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-slate-600">
                  <p className="text-xs">No personas yet</p>
                  <button
                    onClick={() => {
                      setEditingPersona(undefined);
                      setShowPersonaModal(true);
                    }}
                    className="mt-2 text-xs text-amber-400 hover:text-amber-300"
                  >
                    Create one
                  </button>
                </div>
              ) : (
                agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    selected={selectedAgentId === agent.id}
                    onStop={handleStopAgent}
                    onClick={() => {
                      setSelectedPersona(null);
                      setSelectedAgentId(
                        selectedAgentId === agent.id ? null : agent.id
                      );
                    }}
                  />
                ))
              )}
              {/* + New Persona */}
              <button
                onClick={() => {
                  setEditingPersona(undefined);
                  setShowPersonaModal(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#2d3348] bg-transparent py-2.5 text-slate-500 transition-colors hover:border-amber-500/40 hover:text-slate-400"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="text-[11px]">New Persona</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {Object.entries(personasByDepartment).map(([dept, deptPersonas]) => (
                <div key={dept}>
                  <h3 className="text-[10px] uppercase tracking-wider text-slate-600 mt-4 mb-2 px-1 first:mt-0">
                    {dept.replace(/-/g, " ")}
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {deptPersonas.map((persona) => (
                      <CompactPersonaCard
                        key={persona.id}
                        persona={persona}
                        busyAgent={getBusyAgentForPersona(persona)}
                        selected={selectedPersona?.id === persona.id && rightPanelMode === "persona-detail"}
                        onClick={() => {
                          const busy = getBusyAgentForPersona(persona);
                          if (busy) {
                            // If busy, go directly to agent conversation
                            setSelectedPersona(null);
                            setSelectedAgentId(busy.id);
                          } else {
                            // Show persona detail
                            setSelectedAgentId(null);
                            setSelectedPersona(
                              selectedPersona?.id === persona.id ? null : persona
                            );
                          }
                        }}
                        onEdit={() => handleEditPersona(persona)}
                        onDelete={() => handleDeletePersona(persona)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Show any running agents not matched to a persona */}
              {agents.filter(
                (a) =>
                  a.status === "running" &&
                  !personas.some((p) => p.name === a.role)
              ).length > 0 && (
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-slate-600 mt-4 mb-2 px-1">
                    Custom Agents
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {agents
                      .filter(
                        (a) =>
                          a.status === "running" &&
                          !personas.some((p) => p.name === a.role)
                      )
                      .map((agent) => (
                        <AgentCard
                          key={agent.id}
                          agent={agent}
                          selected={selectedAgentId === agent.id}
                          onStop={handleStopAgent}
                          onClick={() => {
                            setSelectedPersona(null);
                            setSelectedAgentId(
                              selectedAgentId === agent.id ? null : agent.id
                            );
                          }}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* + New Persona */}
              <button
                onClick={() => {
                  setEditingPersona(undefined);
                  setShowPersonaModal(true);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#2d3348] bg-transparent py-2.5 mt-4 text-slate-500 transition-colors hover:border-amber-500/40 hover:text-slate-400"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="text-[11px]">New Persona</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — minimal: task count left, actions right */}
        <div className="flex items-center justify-between border-b border-[#1e2231] px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-slate-400">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </span>
            <span className="text-[12px] text-slate-500">
              {agents.filter(a => a.status === "running").length}/{maxConcurrent} agents
            </span>
          </div>
          <div className="flex items-center gap-2">
            {linearConnected && (
              <button
                onClick={() => {
                  setShowLinearImport(true);
                  setShowCreateTask(false);
                  setShowLaunchPanel(false);
                }}
                className="rounded-lg border border-[#5E6AD2]/30 px-3 py-1.5 text-[12px] font-medium text-[#5E6AD2] transition-colors hover:border-[#5E6AD2]/60 hover:bg-[#5E6AD2]/5"
              >
                Import from Linear
              </button>
            )}
            <button
              onClick={() => {
                setShowCreateTask(!showCreateTask);
                setShowLaunchPanel(false);
                setShowLinearImport(false);
              }}
              className="rounded-lg border border-[#1e2231] px-3 py-1.5 text-[12px] font-medium text-slate-300 transition-colors hover:border-[#2d3348] hover:text-white"
            >
              + Task
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Content: context-sensitive */}
        {rightPanelMode === "agent-conversation" && selectedAgent ? (
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            {/* Conversation header */}
            <div className="shrink-0 border-b border-[#1e2231] px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedAgentId(null)}
                    className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back to Board
                  </button>
                  <div className="h-4 w-px bg-[#1e2231]" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-200">
                        {selectedAgent.display_name ?? `${selectedAgent.agent_type} agent`}
                      </h3>
                      {selectedAgent.status === "running" && (
                        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Live
                        </span>
                      )}
                      {selectedAgent.status !== "running" && (
                        <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                          {selectedAgent.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-slate-500 uppercase tracking-wide">
                        {selectedAgent.agent_type}
                        {selectedAgent.role ? ` / ${selectedAgent.role}` : ""}
                      </span>
                      {selectedAgent.project_path && (
                        <span className="mono text-[11px] text-slate-600 truncate max-w-[200px]">
                          {selectedAgent.project_path}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversation body */}
            {agentMessagesLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center text-slate-600">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent mb-3" />
                <p className="text-xs">Loading conversation...</p>
              </div>
            ) : agentMessages.length === 0 && !selectedAgent.session_id ? (
              <div className="flex flex-1 flex-col items-center justify-center text-slate-600">
                <p className="text-xs">No conversation found</p>
                <p className="text-[10px] text-slate-700 mt-1">
                  {selectedAgent.status === "running"
                    ? "Agent is still running — messages will appear after re-indexing"
                    : "Session may not have been indexed yet. Try triggering a re-index from Home."}
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <ChatViewer
                  messages={agentMessages}
                  session={agentSession ?? undefined}
                  isLoading={false}
                />
              </div>
            )}
          </div>
        ) : rightPanelMode === "persona-detail" && selectedPersona ? (
          <PersonaDetailPanel
            persona={selectedPersona}
            busyAgent={getBusyAgentForPersona(selectedPersona)}
            onBack={() => setSelectedPersona(null)}
            onAssign={(taskDesc, projectPath) =>
              handleAssignPersona(selectedPersona, taskDesc, projectPath)
            }
            onViewAgent={(agentId) => {
              setSelectedPersona(null);
              setSelectedAgentId(agentId);
            }}
          />
        ) : (
          /* Default: Kanban board (full width) */
          <div className="flex-1 overflow-auto p-4">
            <KanbanBoard
              tasks={tasks}
              loopStates={loopStates}
              runningAgents={agents}
              onTaskClick={handleTaskClick}
              onAddTask={handleAddTask}
              onAssignAgent={(task) => {
                setPendingAssignTask(task);
                setShowPersonaPicker(true);
              }}
            />
          </div>
        )}
      </div>

      {/* Create Task Dialog */}
      <Dialog open={showCreateTask} onOpenChange={setShowCreateTask}>
        <DialogContent hideClose className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">New Task</DialogTitle>
          <DialogDescription className="sr-only">Create a new task for the board</DialogDescription>
          <CreateTaskPanel
            onClose={() => setShowCreateTask(false)}
            onCreate={handleCreateTask}
          />
        </DialogContent>
      </Dialog>

      {/* Launch Agent Dialog */}
      <Dialog open={showLaunchPanel} onOpenChange={setShowLaunchPanel}>
        <DialogContent hideClose className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">Launch Agent</DialogTitle>
          <DialogDescription className="sr-only">Configure and launch a new agent</DialogDescription>
          <LaunchAgentForm
            onClose={() => setShowLaunchPanel(false)}
            onLaunch={handleLaunch}
            presets={presets}
            onPresetsChanged={loadPresets}
          />
        </DialogContent>
      </Dialog>

      {/* Import from Linear Dialog */}
      <Dialog open={showLinearImport} onOpenChange={setShowLinearImport}>
        <DialogContent hideClose className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">Import from Linear</DialogTitle>
          <DialogDescription className="sr-only">Select Linear issues to import as tasks</DialogDescription>
          <ImportLinearModal
            onClose={() => setShowLinearImport(false)}
            onImported={refresh}
          />
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={showReviewModal} onOpenChange={setShowReviewModal}>
        <DialogContent hideClose className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">Start Review</DialogTitle>
          <DialogDescription className="sr-only">Configure and start a code review</DialogDescription>
          <ReviewModal
            onClose={() => setShowReviewModal(false)}
            onCreated={refresh}
          />
        </DialogContent>
      </Dialog>

      {/* Test Gen Dialog */}
      <Dialog open={showTestGenModal} onOpenChange={setShowTestGenModal}>
        <DialogContent hideClose className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">Generate Test</DialogTitle>
          <DialogDescription className="sr-only">Generate a Playwright test for a URL</DialogDescription>
          <TestGenModal
            onClose={() => setShowTestGenModal(false)}
            onCreated={refresh}
          />
        </DialogContent>
      </Dialog>

      {/* Create / Edit Persona Dialog */}
      <Dialog
        open={showPersonaModal}
        onOpenChange={(open) => {
          setShowPersonaModal(open);
          if (!open) setEditingPersona(undefined);
        }}
      >
        <DialogContent hideClose className="max-h-[85vh] overflow-y-auto">
          <DialogTitle className="sr-only">
            {editingPersona ? "Edit Persona" : "Create Persona"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editingPersona ? "Edit an existing agent persona" : "Create a new agent persona"}
          </DialogDescription>
          <PersonaModal
            existingPersona={editingPersona}
            existingDepartments={Object.keys(personasByDepartment)}
            onClose={() => {
              setShowPersonaModal(false);
              setEditingPersona(undefined);
            }}
            onSaved={loadPersonas}
          />
        </DialogContent>
      </Dialog>

      {/* Persona Picker Dialog */}
      <Dialog open={showPersonaPicker} onOpenChange={setShowPersonaPicker}>
        <DialogContent hideClose className="max-w-sm">
          <DialogTitle className="text-sm font-semibold text-slate-200">
            Choose an Agent
          </DialogTitle>
          <DialogDescription className="text-[12px] text-slate-500 mb-3">
            {pendingAssignTask
              ? `Assign "${pendingAssignTask.title}" to a persona`
              : "Select a persona to assign this task to"}
          </DialogDescription>
          <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
            {personas
              .filter((p) => !agents.some((a) => a.status === "running" && a.role === p.name))
              .map((persona) => {
                const accentColor = COLOR_MAP[persona.color] || "#f59e0b";
                return (
                  <button
                    key={persona.id}
                    onClick={() => {
                      setShowPersonaPicker(false);
                      if (pendingAssignTask) {
                        const taskDesc = pendingAssignTask.title +
                          (pendingAssignTask.description ? `\n\n${pendingAssignTask.description}` : "");
                        const projectPath = pendingAssignTask.project_path || "";
                        if (projectPath) {
                          // Has project path — launch immediately
                          handleAssignPersona(persona, taskDesc, projectPath, pendingAssignTask.id);
                        } else {
                          // No project path — just assign the agent to the task (mark in_progress)
                          // User can launch manually from the persona detail
                          updateTask(pendingAssignTask.id, "in_progress", persona.name).catch(() => {});
                          refresh();
                        }
                        setPendingAssignTask(null);
                      } else {
                        setSelectedAgentId(null);
                        setSelectedPersona(persona);
                      }
                    }}
                    className="flex items-center gap-3 rounded-lg border border-[#1e2231] bg-[#13151c] p-3 text-left transition-colors hover:border-[#2d3348] hover:bg-[#1a1d27]"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: accentColor }}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-200 truncate">
                        {persona.name}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {persona.department.replace(/-/g, " ")}
                      </p>
                    </div>
                  </button>
                );
              })}
            {personas.filter((p) => !agents.some((a) => a.status === "running" && a.role === p.name)).length === 0 && (
              <p className="text-[12px] text-slate-600 text-center py-4">
                All personas are busy
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
