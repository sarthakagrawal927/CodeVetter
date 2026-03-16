import { useState, useEffect, useCallback } from "react";
import AgentCard from "@/components/agent-card";
import KanbanBoard from "@/components/kanban-board";
import ActivityFeed from "@/components/activity-feed";
import DirectoryPicker from "@/components/directory-picker";
import {
  listAgents,
  launchAgent,
  stopAgent,
  listTasks,
  createTask,
  listActivity,
  listAgentPresets,
  createAgentPreset,
  deleteAgentPreset,
  isTauriAvailable,
  onAgentStatusChanged,
  onActivityUpdate,
  checkLinearConnection,
  listLinearIssues,
  importLinearIssues,
} from "@/lib/tauri-ipc";
import type { AgentProcess, Task, ActivityEvent, AgentPreset, LinearIssue } from "@/lib/tauri-ipc";

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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Agents() {
  const [agents, setAgents] = useState<AgentProcess[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [showLaunchPanel, setShowLaunchPanel] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showLinearImport, setShowLinearImport] = useState(false);
  const [linearConnected, setLinearConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPresets = useCallback(async () => {
    if (!isTauriAvailable()) return;
    try {
      const list = await listAgentPresets();
      setPresets(list);
    } catch (err) {
      console.error("Failed to load presets:", err);
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
      console.error("Failed to refresh Mission Control data:", err);
    }
  }, []);

  useEffect(() => {
    refresh();
    loadPresets();

    // Check Linear connection status (non-blocking)
    if (isTauriAvailable()) {
      checkLinearConnection()
        .then((result) => setLinearConnected(result.connected))
        .catch(() => setLinearConnected(false));
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
  }, [refresh, loadPresets]);

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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1e2231] px-6 py-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Mission Control</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Manage agents, tasks, and monitor activity
          </p>
        </div>
        <div className="flex items-center gap-2">
          {linearConnected && (
            <button
              onClick={() => {
                setShowLinearImport(true);
                setShowCreateTask(false);
                setShowLaunchPanel(false);
              }}
              className="rounded-lg border border-[#5E6AD2]/30 px-4 py-2 text-sm font-medium text-[#5E6AD2] transition-colors hover:border-[#5E6AD2]/60 hover:bg-[#5E6AD2]/5"
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
            className="rounded-lg border border-[#1e2231] px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-[#2d3348] hover:text-white"
          >
            + Task
          </button>
          <button
            onClick={() => {
              setShowLaunchPanel(!showLaunchPanel);
              setShowCreateTask(false);
              setShowLinearImport(false);
            }}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
          >
            <span>+</span>
            Launch Agent
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Agent Squad */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-[#1e2231]">
          <div className="border-b border-[#1e2231] px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Agent Squad ({agents.length})
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex flex-col gap-3">
              {agents.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-slate-600">
                  <p className="text-xs">No agents launched yet</p>
                  <button
                    onClick={() => setShowLaunchPanel(true)}
                    className="mt-2 text-xs text-amber-400 hover:text-amber-300"
                  >
                    Launch one
                  </button>
                </div>
              ) : (
                agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onStop={handleStopAgent}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center: Task Board */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-[#1e2231] px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Task Board ({tasks.length})
            </h2>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <KanbanBoard tasks={tasks} />
          </div>
        </div>

        {/* Right: Activity Feed */}
        <div className="flex w-[300px] shrink-0 flex-col border-l border-[#1e2231]">
          <div className="border-b border-[#1e2231] px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Activity Feed
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <ActivityFeed events={activity} />
          </div>
        </div>
      </div>

      {/* Create Task Modal Overlay */}
      {showCreateTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <CreateTaskPanel
              onClose={() => setShowCreateTask(false)}
              onCreate={handleCreateTask}
            />
          </div>
        </div>
      )}

      {/* Launch Agent Modal Overlay */}
      {showLaunchPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <LaunchAgentForm
              onClose={() => setShowLaunchPanel(false)}
              onLaunch={handleLaunch}
              presets={presets}
              onPresetsChanged={loadPresets}
            />
          </div>
        </div>
      )}

      {/* Import from Linear Modal Overlay */}
      {showLinearImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <ImportLinearModal
            onClose={() => setShowLinearImport(false)}
            onImported={refresh}
          />
        </div>
      )}
    </div>
  );
}
