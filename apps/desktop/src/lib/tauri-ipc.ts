import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely invoke a Tauri command. Returns `undefined` when running outside
 * of the Tauri webview (e.g. SSR, `next dev`, or Storybook).
 */
async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    // If Tauri APIs simply aren't available (SSR / browser dev), throw a
    // distinguishable error so callers can show a fallback UI.
    if (
      typeof window === "undefined" ||
      typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ===
        "undefined"
    ) {
      throw new Error("TAURI_NOT_AVAILABLE");
    }
    throw err;
  }
}

/**
 * Returns true when running inside a real Tauri webview.
 */
export function isTauriAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !==
      "undefined"
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// REAL BACKEND TYPES (matching Rust structs from db/queries.rs)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Session Types (real backend) ───────────────────────────────────────────

/** Matches the Rust `SessionRow` struct exactly. */
export interface SessionRow {
  id: string;
  project_id: string;
  agent_type: string;
  jsonl_path: string | null;
  git_branch: string | null;
  cwd: string | null;
  cli_version: string | null;
  first_message: string | null;
  last_message: string | null;
  message_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  compaction_count: number;
  estimated_cost_usd: number;
  model_used: string | null;
  slug: string | null;
  file_size_bytes: number;
  indexed_at: string | null;
  file_mtime: string | null;
}

/** Matches the Rust `MessageRow` struct exactly. */
export interface MessageRow {
  id: string;
  session_id: string;
  parent_uuid: string | null;
  type: string | null;
  role: string | null;
  content_text: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  timestamp: string | null;
  line_number: number | null;
  is_sidechain: number;
}

/** Matches the Rust `SearchResult` struct exactly. */
export interface SearchResult {
  message_id: string;
  session_id: string;
  content_text: string;
  role: string | null;
  timestamp: string | null;
  rank: number;
}

/** Matches the Rust `AgentProcessRow` struct exactly. */
export interface AgentProcess {
  id: string;
  agent_type: string;
  project_path: string | null;
  session_id: string | null;
  pid: number | null;
  role: string | null;
  display_name: string | null;
  status: string;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
  started_at: string | null;
  stopped_at: string | null;
}

/** Matches the Rust `LocalReviewRow` struct exactly. */
export interface LocalReviewRow {
  id: string;
  review_type: string | null;
  source_label: string | null;
  repo_path: string | null;
  repo_full_name: string | null;
  pr_number: number | null;
  agent_used: string;
  score_composite: number | null;
  findings_count: number | null;
  review_action: string | null;
  summary_markdown: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** Matches the Rust `LocalReviewFindingRow` struct exactly. */
export interface LocalReviewFindingRow {
  id: string;
  review_id: string;
  severity: string | null;
  title: string | null;
  summary: string | null;
  suggestion: string | null;
  file_path: string | null;
  line: number | null;
  confidence: number | null;
  fingerprint: string | null;
}

/** Matches the Rust `IndexStats` struct exactly (+ last_indexed_at from preferences). */
export interface IndexStats {
  project_count: number;
  session_count: number;
  message_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  last_indexed_at: string | null;
}

export interface TriggerIndexResult {
  indexed_sessions: number;
  indexed_messages: number;
  projects_scanned: number;
}

/** Matches the Rust `AgentTaskRow` struct exactly. */
export interface AgentTaskRow {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  project_path: string | null;
  workspace_id: string | null;
  status: string;
  assigned_agent: string | null;
  review_id: string | null;
  review_score: number | null;
  review_attempts: number;
  created_at: string;
  updated_at: string;
}

/** Matches the Rust `ActivityRow` struct exactly. */
export interface ActivityRow {
  id: string;
  agent_id: string | null;
  event_type: string | null;
  summary: string | null;
  metadata: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKWARD-COMPATIBLE TYPE ALIASES
// These are used by existing UI pages (agents, review, etc.) that still
// use placeholder data with the old field names. As those pages are
// migrated to real IPC calls, these can be removed.
// ═══════════════════════════════════════════════════════════════════════════

// -- Session aliases (used by old session-card shape) --
export type SessionListItem = SessionRow;
export type SessionMessage = MessageRow;

// -- Review aliases (all now point to real backend types) --
export type ReviewTone = "concise" | "thorough" | "mentoring" | "strict";
export type Review = LocalReviewRow;
export type ReviewFinding = LocalReviewFindingRow;
export interface ReviewListItem {
  id: string;
  repoPath: string;
  score: number;
  findingCount: number;
  status: Review["status"];
  createdAt: string;
}

// -- Agent aliases --
export type AgentAdapter = "claude-code" | "codex" | "cursor";
export type AgentStatus = "idle" | "running" | "paused" | "stopped" | "error";
export type AgentRole = "reviewer" | "coder" | "planner" | "debugger";

/**
 * @deprecated Use `AgentProcess` for real backend data.
 * This old shape is used by agent-card.tsx and agents/page.tsx placeholders.
 */
export interface Agent {
  id: string;
  adapter: AgentAdapter;
  projectPath: string;
  role: AgentRole;
  status: AgentStatus;
  currentTask?: string;
  pid?: number;
  launchedAt: string;
  lastActivity?: string;
}

// -- Task aliases (all now point to real backend types) --
export type TaskStatus = "backlog" | "in_progress" | "review" | "done";
export type Task = AgentTaskRow;

// -- Activity aliases (all now point to real backend types) --
export type ActivityEvent = ActivityRow;

// -- Pagination --
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKEND RESPONSE WRAPPERS
// The Rust backend returns JSON like { "sessions": [...] }, etc.
// ═══════════════════════════════════════════════════════════════════════════

interface SessionsResponse {
  sessions: SessionRow[];
}

interface SessionDetailResponse {
  session: SessionRow;
  messages: MessageRow[];
}

interface SearchResponse {
  results: SearchResult[];
}

interface ReviewsResponse {
  reviews: LocalReviewRow[];
}

interface AgentsResponse {
  agents: AgentProcess[];
}

// ═══════════════════════════════════════════════════════════════════════════
// TAURI COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

// ─── Review Commands ─────────────────────────────────────────────────────────

export async function getLocalDiff(
  repoPath: string,
  diffRange?: string,
): Promise<{ diff: string; files: Array<{ path: string; status: string }>; empty: boolean }> {
  return safeInvoke("get_local_diff", {
    repoPath,
    diffRange: diffRange ?? null,
  });
}

export interface SaveReviewInput {
  repoPath?: string;
  sourceLabel: string;
  reviewType: string;
  repoFullName?: string;
  prNumber?: number;
  score: number;
  findings: Array<{
    severity: string;
    title: string;
    summary: string;
    suggestion?: string;
    filePath?: string;
    line?: number;
    confidence?: number;
    fingerprint?: string;
  }>;
  reviewAction?: string;
  summaryMarkdown?: string;
}

export async function saveReview(
  input: SaveReviewInput
): Promise<{ review_id: string; status: string; score: number; findings_count: number }> {
  return safeInvoke("save_review", input);
}

// Legacy wrappers — these now go through the webview review-core pipeline.
// TODO: Replace callers with direct review-core integration.
export async function startLocalReview(
  repoPath: string,
  diffRange?: string,
  _tone?: ReviewTone
): Promise<{ review_id: string; status: string; diff_bytes: number }> {
  // Temporary: get diff and return a stub — full review-core integration in Phase 2
  const diff = await getLocalDiff(repoPath, diffRange);
  if (diff.empty) throw new Error("No changes to review");
  return { review_id: "pending", status: "not_implemented", diff_bytes: diff.diff.length };
}

export async function startPrReview(
  _owner: string,
  _repo: string,
  _prNumber: number,
  _tone?: ReviewTone
): Promise<{ review_id: string; status: string; diff_bytes: number }> {
  // Temporary stub — full PR review via PAT in Phase 3
  throw new Error("PR review via sidecar removed. Review-core integration coming in Phase 3.");
}

export async function getReview(
  id: string
): Promise<{ review: Review; findings: ReviewFinding[] }> {
  return safeInvoke("get_review", { id });
}

export async function listReviews(
  limit?: number,
  offset?: number,
  repoPath?: string
): Promise<LocalReviewRow[]> {
  const resp = await safeInvoke<ReviewsResponse>("list_reviews", {
    limit: limit ?? 50,
    offset: offset ?? 0,
    repo_path: repoPath ?? null,
  });
  return resp.reviews;
}

// ─── CLI Review ──────────────────────────────────────────────────────────────

export interface CliReviewFinding {
  severity: string;
  title: string;
  summary: string;
  suggestion?: string;
  filePath?: string;
  line?: number;
  confidence?: number;
}

export interface CliReviewResult {
  review_id: string;
  score: number;
  findings: CliReviewFinding[];
  summary: string;
  agent: string;
  duration_ms: number;
  diff_range: string;
  findings_count: number;
}

export interface FixChangedFile {
  status: string;
  path: string;
}

export interface FixFindingsResult {
  success: boolean;
  agent: string;
  duration_ms: number;
  findings_fixed: number;
  diff: string;
  changed_files: FixChangedFile[];
}

export interface RevertFilesResult {
  reverted: string[];
  failed: { file: string; error: string }[];
}

export async function runCliReview(
  repoPath: string,
  diffRange: string,
  projectDescription: string,
  changeDescription: string,
  agent?: string,
): Promise<CliReviewResult> {
  return safeInvoke("run_cli_review", {
    repoPath,
    diffRange,
    projectDescription,
    changeDescription,
    agent: agent ?? null,
  });
}

export async function fixFindings(
  repoPath: string,
  findings: CliReviewFinding[],
  agent?: string,
): Promise<FixFindingsResult> {
  return safeInvoke("fix_findings", {
    repoPath,
    findings,
    agent: agent ?? null,
  });
}

export async function revertFiles(
  repoPath: string,
  files: string[],
): Promise<RevertFilesResult> {
  return safeInvoke("revert_files", {
    repoPath,
    files,
  });
}

// ─── Session Commands ────────────────────────────────────────────────────────

export async function listSessions(
  query?: string,
  project?: string,
  limit?: number,
  offset?: number
): Promise<SessionRow[]> {
  const resp = await safeInvoke<SessionsResponse>("list_sessions", {
    query: query ?? null,
    project: project ?? null,
    limit: limit ?? 50,
    offset: offset ?? 0,
  });
  return resp.sessions;
}

export async function getSession(
  id: string
): Promise<{ session: SessionRow; messages: MessageRow[] }> {
  return safeInvoke<SessionDetailResponse>("get_session", { id });
}

export async function searchMessages(query: string): Promise<SearchResult[]> {
  const resp = await safeInvoke<SearchResponse>("search_messages", { query });
  return resp.results;
}

// ─── Session Subagent Commands ───────────────────────────────────────────────

export interface SubagentSummary {
  agentId: string;
  slug: string | null;
  startedAt: string | null;
  endedAt: string | null;
  lineCount: number;
  taskDescription: string | null;
}

export async function listSessionSubagents(
  sessionId: string,
  projectPath: string
): Promise<SubagentSummary[]> {
  const resp = await safeInvoke<{ subagents: SubagentSummary[] }>(
    "list_session_subagents",
    { sessionId: sessionId, projectPath: projectPath }
  );
  return resp.subagents;
}

export async function deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
  return safeInvoke("delete_session", { sessionId: sessionId });
}

// ─── Session Merge Commands ──────────────────────────────────────────────────

export async function mergeSessions(
  sessionIds: string[],
  targetProjectId: string,
  mergedName?: string
): Promise<{ merged_session_id: string }> {
  return safeInvoke("merge_sessions", {
    sessionIds: sessionIds,
    targetProjectId: targetProjectId,
    mergedName: mergedName ?? null,
  });
}

export async function mergeProjects(
  sourceProjectIds: string[],
  targetProjectId: string
): Promise<{ moved_sessions: number }> {
  return safeInvoke("merge_projects", {
    sourceProjectIds: sourceProjectIds,
    targetProjectId: targetProjectId,
  });
}

// ─── Indexing Commands ───────────────────────────────────────────────────────

export async function triggerIndex(): Promise<TriggerIndexResult> {
  return safeInvoke<TriggerIndexResult>("trigger_index");
}

export async function getIndexStats(): Promise<IndexStats> {
  return safeInvoke<IndexStats>("get_index_stats");
}



// ─── Agent Commands ──────────────────────────────────────────────────────────

export async function launchAgent(
  adapter: string,
  projectPath: string,
  role?: string,
  task?: string,
  reviewId?: string,
  resumeSessionId?: string
): Promise<{
  agent_id: string;
  adapter: string;
  pid: number | null;
  status: string;
  review_id: string | null;
}> {
  return safeInvoke("launch_agent", {
    adapter,
    projectPath: projectPath,
    role: role ?? null,
    task: task ?? null,
    reviewId: reviewId ?? null,
    resumeSessionId: resumeSessionId ?? null,
  });
}

export async function stopAgent(
  agentId: string
): Promise<{ agent_id: string; status: string }> {
  return safeInvoke("stop_agent", { agentId: agentId });
}

export async function listAgents(): Promise<AgentProcess[]> {
  const resp = await safeInvoke<AgentsResponse>("list_agents");
  return resp.agents;
}

export async function getAgent(
  id: string
): Promise<{ agent: AgentProcess; total_cost_usd: number }> {
  return safeInvoke("get_agent", { id });
}

export interface DetectedAgent {
  pid: number;
  cpu: string;
  mem: string;
  command: string;
  agent_type: string;
}

export async function detectRunningAgents(): Promise<DetectedAgent[]> {
  const resp = await safeInvoke<{ running_agents: DetectedAgent[] }>(
    "detect_running_agents"
  );
  return resp.running_agents;
}

// ─── Task Commands ───────────────────────────────────────────────────────────

export async function createTask(
  title: string,
  description: string,
  acceptanceCriteria?: string,
  projectPath?: string,
  workspaceId?: string
): Promise<string> {
  return safeInvoke("create_task", {
    title,
    description,
    acceptanceCriteria: acceptanceCriteria ?? null,
    projectPath: projectPath ?? null,
    workspaceId: workspaceId ?? null,
  });
}

export async function updateTask(
  id: string,
  status?: string,
  assignedAgent?: string
): Promise<void> {
  return safeInvoke("update_task", {
    id,
    status: status ?? null,
    assignedAgent: assignedAgent ?? null,
  });
}

export async function listTasks(status?: string): Promise<Task[]> {
  const resp = await safeInvoke<{ tasks: Task[] }>("list_tasks", {
    status: status ?? null,
  });
  return resp.tasks;
}

// ─── Activity Commands ───────────────────────────────────────────────────────

export async function listActivity(
  agentId?: string,
  limit?: number
): Promise<ActivityEvent[]> {
  const resp = await safeInvoke<{ activity: ActivityEvent[] }>("list_activity", {
    agentId: agentId ?? null,
    limit: limit ?? 50,
  });
  return resp.activity;
}

// ─── Messaging Commands ─────────────────────────────────────────────────────

export async function sendAgentMessage(
  threadId: string,
  content: string,
  mentions?: string[]
): Promise<void> {
  return safeInvoke("send_agent_message", {
    threadId: threadId,
    content,
    mentions: mentions ?? null,
  });
}

// ─── Thread Messages ────────────────────────────────────────────────────────

export interface AgentMessage {
  id: string;
  thread_id: string;
  sender_type: string;
  sender_agent_id: string | null;
  content: string;
  mentions: string | null;
  delivered: number;
  created_at: string;
}

export async function listThreadMessages(
  threadId: string,
  limit?: number
): Promise<AgentMessage[]> {
  const resp = await safeInvoke<{ messages: AgentMessage[] }>(
    "list_thread_messages",
    { threadId: threadId, limit: limit ?? 100 }
  );
  return resp.messages;
}

// ─── Cost Dashboard ─────────────────────────────────────────────────────────

export interface AgentCostSummary {
  agent_id: string;
  agent_type: string;
  display_name: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  entry_count: number;
}

export interface CostDashboardData {
  agents: AgentCostSummary[];
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

export async function getCostDashboard(): Promise<CostDashboardData> {
  return safeInvoke<CostDashboardData>("get_cost_dashboard");
}

// ─── Agent Preset Commands ───────────────────────────────────────────────────

export interface AgentPreset {
  id: string;
  name: string;
  adapter: string;
  role: string | null;
  system_prompt: string | null;
  model: string | null;
  max_turns: number | null;
  allowed_tools: string | null;
  output_format: string | null;
  print_mode: number;
  no_session_persist: number;
  approval_mode: string | null;
  quiet_mode: number;
  created_at: string;
  updated_at: string;
}

export async function listAgentPresets(): Promise<AgentPreset[]> {
  const resp = await safeInvoke<{ presets: AgentPreset[] }>("list_agent_presets");
  return resp.presets;
}

export async function createAgentPreset(preset: {
  name: string;
  adapter: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string;
  outputFormat?: string;
  printMode?: boolean;
  noSessionPersist?: boolean;
  approvalMode?: string;
  quietMode?: boolean;
}): Promise<{ id: string; preset: AgentPreset }> {
  return safeInvoke("create_agent_preset", {
    name: preset.name,
    adapter: preset.adapter,
    role: preset.role ?? null,
    systemPrompt: preset.systemPrompt ?? null,
    model: preset.model ?? null,
    maxTurns: preset.maxTurns ?? null,
    allowedTools: preset.allowedTools ?? null,
    outputFormat: preset.outputFormat ?? null,
    printMode: preset.printMode ?? false,
    noSessionPersist: preset.noSessionPersist ?? false,
    approvalMode: preset.approvalMode ?? null,
    quietMode: preset.quietMode ?? false,
  });
}

export async function updateAgentPreset(preset: {
  id: string;
  name: string;
  adapter: string;
  role?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string;
  outputFormat?: string;
  printMode?: boolean;
  noSessionPersist?: boolean;
  approvalMode?: string;
  quietMode?: boolean;
}): Promise<{ id: string }> {
  return safeInvoke("update_agent_preset", {
    id: preset.id,
    name: preset.name,
    adapter: preset.adapter,
    role: preset.role ?? null,
    systemPrompt: preset.systemPrompt ?? null,
    model: preset.model ?? null,
    maxTurns: preset.maxTurns ?? null,
    allowedTools: preset.allowedTools ?? null,
    outputFormat: preset.outputFormat ?? null,
    printMode: preset.printMode ?? false,
    noSessionPersist: preset.noSessionPersist ?? false,
    approvalMode: preset.approvalMode ?? null,
    quietMode: preset.quietMode ?? false,
  });
}

export async function deleteAgentPreset(id: string): Promise<void> {
  await safeInvoke("delete_agent_preset", { id });
}

// ─── Provider Account Commands ──────────────────────────────────────────────

export interface ProviderAccount {
  id: string;
  name: string;
  provider: string; // 'anthropic' | 'openai'
  api_key: string | null;
  monthly_limit: number | null;
  plan: string | null;
  weekly_limit: number | null;
  created_at: string;
  updated_at: string;
}

export interface AccountUsage {
  account_id: string;
  provider: string;
  plan: string | null;
  // Baseline
  weekly_baseline: number | null;
  baseline_source: "custom" | "avg_4w" | "last_week" | "none";
  last_week_cost: number;
  avg_week_cost: number;
  // This week
  week_cost: number;
  week_input_tokens: number;
  week_output_tokens: number;
  week_sessions: number;
  week_pct: number | null;
  week_remaining: number | null;
  // Pace
  day_of_week: number; // 1=Mon..7=Sun
  expected_pct: number;
  // Today
  today_cost: number;
  // Latest session
  session_cost: number;
  session_input_tokens: number;
  session_output_tokens: number;
  session_messages: number;
  session_id: string | null;
}

export async function listProviderAccounts(): Promise<ProviderAccount[]> {
  const resp = await safeInvoke<{ accounts: ProviderAccount[] }>("list_provider_accounts");
  return resp.accounts;
}

export async function createProviderAccount(opts: {
  name: string;
  provider: string;
  apiKey?: string;
  monthlyLimit?: number;
  plan?: string;
  weeklyLimit?: number;
}): Promise<{ id: string; account: ProviderAccount }> {
  return safeInvoke("create_provider_account", {
    name: opts.name,
    provider: opts.provider,
    apiKey: opts.apiKey ?? null,
    monthlyLimit: opts.monthlyLimit ?? null,
    plan: opts.plan ?? null,
    weeklyLimit: opts.weeklyLimit ?? null,
  });
}

export async function updateProviderAccount(opts: {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;
  monthlyLimit?: number;
  plan?: string;
  weeklyLimit?: number;
}): Promise<{ id: string }> {
  return safeInvoke("update_provider_account", {
    id: opts.id,
    name: opts.name,
    provider: opts.provider,
    apiKey: opts.apiKey ?? null,
    monthlyLimit: opts.monthlyLimit ?? null,
    plan: opts.plan ?? null,
    weeklyLimit: opts.weeklyLimit ?? null,
  });
}

export async function deleteProviderAccount(id: string): Promise<void> {
  await safeInvoke("delete_provider_account", { id });
}

export async function checkAccountUsage(accountId: string): Promise<AccountUsage> {
  return safeInvoke("check_account_usage", { accountId: accountId });
}

export interface RateLimitWindow {
  utilization: number | null; // 0.0–1.0
  utilization_pct: number | null; // 0–100
  reset_at: number | null; // unix epoch seconds
  resets_in_secs: number | null;
  status: string | null; // "allowed" | "rate_limited"
}

export interface LiveUsageResult {
  supported: boolean;
  reason?: string;
  status?: string; // unified status: "allowed" | "rate_limited" | "unknown"
  five_h?: RateLimitWindow;
  seven_d?: RateLimitWindow;
  representative_claim?: string; // "five_hour" | "weekly"
  overage_status?: string;
  overage_disabled_reason?: string;
  fallback_pct?: number;
  checked_at?: string;
}

export async function checkLiveUsage(provider: string, credentialKey?: string): Promise<LiveUsageResult> {
  return safeInvoke("check_live_usage", { provider, credentialKey: credentialKey ?? null });
}

export interface DetectedAccountInfo {
  provider: string;
  name: string;
  email: string | null;
  org_id: string | null;
  org_name: string | null;
  plan: string | null;
}

export async function detectProviderAccounts(): Promise<{
  detected: DetectedAccountInfo[];
  created: number;
  accounts: ProviderAccount[];
}> {
  return safeInvoke("detect_provider_accounts");
}

// ─── Preferences Commands ────────────────────────────────────────────────────

export async function getPreference(key: string): Promise<string | null> {
  const resp = await safeInvoke<{ key: string; value: string | null }>(
    "get_preference",
    { key }
  );
  return resp.value;
}

export async function setPreference(
  key: string,
  value: string
): Promise<void> {
  return safeInvoke("set_preference", { key, value });
}

// ─── Setup / Onboarding Commands ────────────────────────────────────────────

export interface PrerequisiteStatus {
  claude_code: boolean;
  github_cli: boolean;
  codex: boolean;
}

export async function checkPrerequisites(): Promise<PrerequisiteStatus> {
  return safeInvoke("check_prerequisites");
}

// ─── Git Commands ───────────────────────────────────────────────────────────

export interface GitBranchesResult {
  branches: string[];
  current: string | null;
}

export async function listGitBranches(
  repoPath: string
): Promise<GitBranchesResult> {
  return safeInvoke("list_git_branches", { repoPath: repoPath });
}

export interface GitRemoteInfo {
  url: string;
  owner: string;
  repo: string;
}

export async function getGitRemoteInfo(
  repoPath: string
): Promise<GitRemoteInfo> {
  return safeInvoke("get_git_remote_info", { repoPath: repoPath });
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  author: { login: string } | null;
}

export async function listPullRequests(
  repoPath: string
): Promise<PullRequest[]> {
  const resp = await safeInvoke<{ pull_requests: PullRequest[] }>(
    "list_pull_requests",
    { repoPath: repoPath }
  );
  return resp.pull_requests;
}

// ─── GitHub Auth ────────────────────────────────────────────────────────────

export interface GitHubAuthStatus {
  connected: boolean;
  method: "pat" | "env" | "gh_cli" | null;
  username: string | null;
  scopes: string | null;
}

export async function checkGitHubAuth(): Promise<GitHubAuthStatus> {
  return safeInvoke("check_github_auth");
}

export async function syncGitHubToken(): Promise<{
  synced: boolean;
  username: string;
}> {
  return safeInvoke("sync_github_token");
}

// ─── Directory Picker ───────────────────────────────────────────────────────

/**
 * Opens a native OS directory picker dialog.
 * Returns the selected path, or null if cancelled.
 */
export async function pickDirectory(
  title?: string
): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: title ?? "Select Directory",
    });
    // open() returns string | string[] | null
    if (Array.isArray(selected)) return selected[0] ?? null;
    return selected;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAURI EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Listen for the `session-updated` event emitted by the file watcher / indexer
 * when new or modified JSONL session files are detected.
 *
 * Returns an unlisten function to clean up the listener.
 */
export function onSessionUpdated(
  callback: (paths: string[]) => void
): Promise<UnlistenFn> {
  return listen<string[]>("session-updated", (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for the `index-complete` event emitted after a re-index finishes.
 */
export function onIndexComplete(
  callback: (result: TriggerIndexResult) => void
): Promise<UnlistenFn> {
  return listen<TriggerIndexResult>("index-complete", (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for the `agent-status-changed` event emitted when an agent's
 * status changes (started, stopped, error, etc.).
 */
export function onAgentStatusChanged(
  callback: (payload: { agent_id: string; status: string }) => void
): Promise<UnlistenFn> {
  return listen<{ agent_id: string; status: string }>(
    "agent-status-changed",
    (event) => {
      callback(event.payload);
    }
  );
}

/**
 * Listen for the `activity-update` event emitted by background watchers
 * (git watcher, agent monitor, auto-review) when new activity occurs.
 */
export interface ActivityUpdatePayload {
  event_type: string;
  summary?: string;
  agent_id?: string;
  task_id?: string;
  review_id?: string;
  score?: number;
  sha?: string;
}

export function onActivityUpdate(
  callback: (payload: ActivityUpdatePayload) => void
): Promise<UnlistenFn> {
  return listen<ActivityUpdatePayload>("activity-update", (event) => {
    callback(event.payload);
  });
}

// ─── Workspace Commands ─────────────────────────────────────────────────────

export interface WorkspaceRow {
  id: string;
  name: string;
  repo_path: string;
  branch: string;
  pr_number: number | null;
  pr_url: string | null;
  status: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export async function listWorkspaces(
  statusFilter?: string
): Promise<WorkspaceRow[]> {
  const resp = await safeInvoke<{ workspaces: WorkspaceRow[] }>(
    "list_workspaces",
    { statusFilter: statusFilter ?? null }
  );
  return resp.workspaces;
}

export async function createWorkspace(opts: {
  name: string;
  repoPath: string;
  branch: string;
  prNumber?: number;
  prUrl?: string;
}): Promise<{ id: string; workspace: WorkspaceRow }> {
  return safeInvoke("create_workspace", {
    name: opts.name,
    repoPath: opts.repoPath,
    branch: opts.branch,
    prNumber: opts.prNumber ?? null,
    prUrl: opts.prUrl ?? null,
  });
}

export async function getWorkspace(
  id: string
): Promise<{ workspace: WorkspaceRow }> {
  return safeInvoke("get_workspace", { id });
}

export async function updateWorkspace(opts: {
  id: string;
  name?: string;
  branch?: string;
  status?: string;
  sessionId?: string;
  prNumber?: number;
  prUrl?: string;
}): Promise<{ id: string }> {
  return safeInvoke("update_workspace", {
    id: opts.id,
    name: opts.name ?? null,
    branch: opts.branch ?? null,
    status: opts.status ?? null,
    sessionId: opts.sessionId ?? null,
    prNumber: opts.prNumber ?? null,
    prUrl: opts.prUrl ?? null,
  });
}

export async function archiveWorkspace(id: string): Promise<void> {
  await safeInvoke("archive_workspace", { id });
}

export async function unarchiveWorkspace(id: string): Promise<void> {
  await safeInvoke("unarchive_workspace", { id });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await safeInvoke("delete_workspace", { id });
}

export async function getWorkspaceGitStatus(
  id: string
): Promise<{ repo_path: string; changed_files: number }> {
  return safeInvoke("get_workspace_git_status", { id });
}

// ─── Chat Tab Commands ──────────────────────────────────────────────────────

export interface ChatTab {
  id: string;
  title: string;
  session_id: string | null;
  project_path: string | null;
  model: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export async function listChatTabs(): Promise<{ tabs: ChatTab[] }> {
  return safeInvoke("list_chat_tabs");
}

export async function createChatTab(
  title?: string,
  projectPath?: string,
  model?: string
): Promise<ChatTab> {
  return safeInvoke("create_chat_tab", {
    title: title ?? null,
    projectPath: projectPath ?? null,
    model: model ?? null,
  });
}

export async function updateChatTab(
  id: string,
  patch: Partial<Pick<ChatTab, "title" | "session_id" | "model" | "project_path">>
): Promise<void> {
  await safeInvoke("update_chat_tab", {
    id,
    title: patch.title ?? null,
    sessionId: patch.session_id ?? null,
    model: patch.model ?? null,
    projectPath: patch.project_path ?? null,
  });
}

export async function deleteChatTab(id: string): Promise<void> {
  await safeInvoke("delete_chat_tab", { id });
}

export async function reorderChatTabs(tabIds: string[]): Promise<void> {
  await safeInvoke("reorder_chat_tabs", { tabIds: tabIds });
}

// ─── Chat Commands ──────────────────────────────────────────────────────────

export interface ChatStreamEvent {
  chat_id: string;
  event_type: string; // "text_delta" | "assistant" | "result" | "done" | "error"
  content: Record<string, unknown>;
}

export async function sendChatMessage(
  message: string,
  sessionId?: string,
  projectPath?: string,
  model?: string,
): Promise<{ chat_id: string; status: string }> {
  return safeInvoke("send_chat_message", {
    message,
    sessionId: sessionId ?? null,
    projectPath: projectPath ?? null,
    model: model ?? null,
  });
}

export async function listChatModels(): Promise<{
  models: { id: string; label: string; default?: boolean }[];
}> {
  return safeInvoke("list_chat_models");
}

export function onChatStream(
  callback: (event: ChatStreamEvent) => void
): Promise<UnlistenFn> {
  return listen<ChatStreamEvent>("chat-stream", (event) => {
    callback(event.payload);
  });
}

// ─── Linear Integration ─────────────────────────────────────────────────────

export interface LinearUser {
  id: string;
  name: string;
  email: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  priorityLabel: string;
  stateName: string;
  stateType: string;
  teamName: string;
  teamKey: string;
  url: string;
  createdAt: string;
}

export async function startLinearOAuth(): Promise<{ success: boolean; error?: string }> {
  return safeInvoke("start_linear_oauth", {});
}

export async function disconnectLinear(): Promise<void> {
  return safeInvoke("disconnect_linear", {});
}

export async function checkLinearConnection(): Promise<{ connected: boolean; user?: LinearUser }> {
  return safeInvoke("check_linear_connection", {});
}

export async function listLinearIssues(): Promise<{ issues: LinearIssue[] }> {
  return safeInvoke("list_linear_issues", {});
}

export async function importLinearIssues(issueIds: string[]): Promise<{ imported: number }> {
  return safeInvoke("import_linear_issues", { issueIds: issueIds });
}

// ─── File Tree Commands ──────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  name: string;
  is_dir: boolean;
  depth: number;
  size_bytes: number | null;
}

export interface FilePreview {
  content: string;
  total_lines: number;
  language: string;
}

export async function listDirectoryTree(
  repoPath: string,
  maxDepth?: number
): Promise<{ entries: FileEntry[] }> {
  return safeInvoke("list_directory_tree", {
    repoPath: repoPath,
    maxDepth: maxDepth ?? null,
  });
}

export async function readFilePreview(
  filePath: string,
  maxLines?: number
): Promise<FilePreview> {
  return safeInvoke("read_file_preview", {
    filePath: filePath,
    maxLines: maxLines ?? null,
  });
}

export interface FileLineData {
  line: number;
  text: string;
  highlight: boolean;
}

export interface FileAroundLineResult {
  lines: FileLineData[];
  language: string;
  target_line: number;
  file_path: string;
}

export async function readFileAroundLine(
  filePath: string,
  line: number,
  contextBefore?: number,
  contextAfter?: number,
): Promise<FileAroundLineResult> {
  return safeInvoke("read_file_around_line", {
    filePath,
    line,
    contextBefore: contextBefore ?? 10,
    contextAfter: contextAfter ?? 10,
  });
}

export async function openInApp(
  appName: string,
  path: string
): Promise<{ success: boolean }> {
  return safeInvoke("open_in_app", { appName: appName, path });
}

// ─── System Monitor ─────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  cpu_percent: number;
  memory_mb: number;
  command: string;
}

export interface SystemStats {
  claude_process_count: number;
  claude_memory_mb: number;
  claude_cpu_percent: number;
  system_memory_total_gb: number;
  system_memory_used_gb: number;
  processes: ProcessInfo[];
}

export async function getSystemStats(): Promise<SystemStats> {
  return safeInvoke("get_system_stats", {});
}

// ─── GitHub PR & CI Operations ──────────────────────────────────────────────

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  mergeable: string;
  reviewDecision: string;
  author: { login: string } | null;
  createdAt: string;
  statusCheckRollup?: CICheck[];
}

export interface CICheck {
  name: string;
  state: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string;
}

export async function createPullRequest(
  repoPath: string,
  title: string,
  body: string,
  baseBranch: string,
  headBranch: string
): Promise<{ url: string; number: number; html_url: string }> {
  return safeInvoke("create_pull_request", {
    repoPath: repoPath,
    title,
    body,
    baseBranch: baseBranch,
    headBranch: headBranch,
  });
}

export async function listPullRequestsForRepo(
  repoPath: string,
  state?: string
): Promise<{ prs: PullRequestInfo[] }> {
  return safeInvoke("list_pull_requests_for_repo", {
    repoPath: repoPath,
    state: state ?? null,
  });
}

export async function getPullRequest(
  repoPath: string,
  prNumber: number
): Promise<PullRequestInfo> {
  return safeInvoke("get_pull_request", { repoPath: repoPath, prNumber: prNumber });
}

export async function mergePullRequest(
  repoPath: string,
  prNumber: number,
  method: string
): Promise<{ success: boolean }> {
  return safeInvoke("merge_pull_request", { repoPath: repoPath, prNumber: prNumber, method });
}

export async function listCiChecks(
  repoPath: string,
  prNumber: number
): Promise<{ checks: CICheck[] }> {
  return safeInvoke("list_ci_checks", { repoPath: repoPath, prNumber: prNumber });
}

export async function rerunFailedChecks(
  repoPath: string,
  prNumber: number
): Promise<{ success: boolean; rerun_count: number }> {
  return safeInvoke("rerun_failed_checks", { repoPath: repoPath, prNumber: prNumber });
}

// ─── Terminal Commands ──────────────────────────────────────────────────────

export async function spawnTerminal(
  cwd: string,
  terminalId: string
): Promise<{ terminal_id: string }> {
  return safeInvoke("spawn_terminal", { cwd, terminalId: terminalId });
}

export async function writeTerminal(
  terminalId: string,
  data: string
): Promise<void> {
  return safeInvoke("write_terminal", { terminalId: terminalId, data });
}

export async function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  return safeInvoke("resize_terminal", { terminalId: terminalId, cols, rows });
}

export async function closeTerminal(terminalId: string): Promise<void> {
  return safeInvoke("close_terminal", { terminalId: terminalId });
}

export function onTerminalOutput(
  handler: (event: { terminal_id: string; data: string }) => void
): Promise<UnlistenFn> {
  return listen<{ terminal_id: string; data: string }>(
    "terminal-output",
    (event) => {
      handler(event.payload);
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CRDT-BASED AGENT COORDINATION
// ═══════════════════════════════════════════════════════════════════════════

// ─── Coordination Types ──────────────────────────────────────────────────────

/** A finding reported by an agent during a coordinated review. */
export interface ReviewFindingCRDT {
  id: string;
  file: string;
  line_start: number;
  line_end: number;
  severity: string;
  message: string;
  agent_id: string;
  timestamp: string;
}

/** Status of a single agent within a coordinated review. */
export interface AgentStatusCRDT {
  status: string;
  current_file: string | null;
  progress: number;
}

/** Full state of a coordinated review document. */
export interface ReviewStateCRDT {
  review_id: string;
  findings: ReviewFindingCRDT[];
  files_claimed: Record<string, string>;
  agent_status: Record<string, AgentStatusCRDT>;
  meta: {
    repo_path: string;
    branch: string;
    created_at: string;
    review_id: string;
  };
}

// ─── Coordination Commands ───────────────────────────────────────────────────

/** Create a new coordinated review document. */
export async function createReviewDoc(
  repoPath: string,
  branch: string
): Promise<{ review_id: string }> {
  return safeInvoke("create_review_doc", { repoPath: repoPath, branch });
}

/** Get the full state of a coordinated review. */
export async function getReviewState(
  reviewId: string,
  repoPath: string
): Promise<ReviewStateCRDT> {
  return safeInvoke("get_review_state", { reviewId: reviewId, repoPath: repoPath });
}

/** Claim a file for an agent. Returns whether the claim succeeded. */
export async function claimFile(
  reviewId: string,
  repoPath: string,
  agentId: string,
  file: string
): Promise<{ claimed: boolean }> {
  return safeInvoke("claim_file", { reviewId: reviewId, repoPath: repoPath, agentId: agentId, file });
}

/** Add a finding to a coordinated review. */
export async function addCoordinatedFinding(
  reviewId: string,
  repoPath: string,
  finding: Omit<ReviewFindingCRDT, "id" | "timestamp">
): Promise<void> {
  await safeInvoke("add_finding", { reviewId: reviewId, repoPath: repoPath, finding });
}

/** Update an agent's status within a coordinated review. */
export async function updateCoordinatedAgentStatus(
  reviewId: string,
  repoPath: string,
  agentId: string,
  status: AgentStatusCRDT
): Promise<void> {
  await safeInvoke("update_agent_status", { reviewId: reviewId, repoPath: repoPath, agentId: agentId, status });
}

/** A single merged finding with deduplication metadata. */
export interface MergedFindingResult {
  finding: ReviewFindingCRDT;
  sources: string[];
  is_duplicate: boolean;
}

/** Full result of finalizing a coordinated review (merge + persist). */
export interface MergedReviewResult {
  review_id: string;
  findings: MergedFindingResult[];
  summary: string;
  total_files_reviewed: number;
  agents_involved: string[];
  duration_seconds: number;
  unique_count: number;
  duplicate_count: number;
}

/**
 * Finalize a coordinated review — merges findings from all agents,
 * deduplicates, persists to SQLite, archives the CRDT doc, and returns
 * the full merged result with stats.
 */
export async function finalizeReview(
  reviewId: string,
  repoPath: string
): Promise<MergedReviewResult> {
  return safeInvoke("finalize_review", { reviewId: reviewId, repoPath: repoPath });
}

// ─── Coordination Events ─────────────────────────────────────────────────────

/**
 * Listen for live review state changes from the coordination layer.
 * Fires on every CRDT mutation (file claim, finding added, status update).
 * Returns an unlisten function to clean up the listener.
 */
export function onReviewStateChanged(
  handler: (state: ReviewStateCRDT) => void
): Promise<UnlistenFn> {
  return listen<ReviewStateCRDT>("review-state-changed", (event) => {
    handler(event.payload);
  });
}

// ─── Diff Comment Commands ──────────────────────────────────────────────────

export interface DiffComment {
  id: string;
  workspace_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  status: string;
  github_comment_id: string | null;
  author: string;
  created_at: string;
  updated_at: string;
}

export interface GitChangedFile {
  status: string;
  path: string;
}

export async function getGitChangedFiles(
  repoPath: string
): Promise<{ files: GitChangedFile[] }> {
  return safeInvoke("get_git_changed_files", { repoPath: repoPath });
}

export async function getFileDiff(
  repoPath: string,
  filePath: string
): Promise<{ diff: string }> {
  return safeInvoke("get_file_diff", { repoPath: repoPath, filePath: filePath });
}

export async function listDiffComments(
  workspaceId: string
): Promise<DiffComment[]> {
  const resp = await safeInvoke<{ comments: DiffComment[] }>(
    "list_diff_comments",
    { workspaceId: workspaceId }
  );
  return resp.comments;
}

export async function createDiffComment(opts: {
  workspaceId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}): Promise<DiffComment> {
  return safeInvoke("create_diff_comment", {
    workspaceId: opts.workspaceId,
    filePath: opts.filePath,
    startLine: opts.startLine,
    endLine: opts.endLine,
    content: opts.content,
  });
}

export async function updateDiffComment(opts: {
  id: string;
  content?: string;
  status?: string;
}): Promise<void> {
  await safeInvoke("update_diff_comment", {
    id: opts.id,
    content: opts.content ?? null,
    status: opts.status ?? null,
  });
}

export async function deleteDiffComment(id: string): Promise<void> {
  await safeInvoke("delete_diff_comment", { id });
}

// ─── Playwright Test Generator ──────────────────────────────────────────────

export interface PlaywrightTestResult {
  name: string;
  status: "passed" | "failed" | "skipped" | "timedOut";
  duration_ms: number;
  error?: string;
}

export interface PlaywrightGenStreamEvent {
  request_id: string;
  event_type: string; // "progress" | "code" | "done" | "error"
  content: Record<string, unknown>;
}

export async function generatePlaywrightTest(
  url: string,
  description: string,
  projectPath?: string,
): Promise<{ request_id: string; test_file: string; status: string }> {
  return safeInvoke("generate_playwright_test", {
    url,
    description,
    projectPath: projectPath ?? null,
  });
}

export async function runPlaywrightTest(
  testFile: string,
  projectPath?: string,
): Promise<{
  passed: boolean;
  results: PlaywrightTestResult[];
  stdout: string;
  stderr: string;
}> {
  return safeInvoke("run_playwright_test", {
    testFile: testFile,
    projectPath: projectPath ?? null,
  });
}

export async function iteratePlaywrightTest(
  testFile: string,
  errorMessage: string,
  url: string,
  description: string,
): Promise<{ request_id: string; test_file: string; status: string }> {
  return safeInvoke("iterate_playwright_test", {
    testFile: testFile,
    errorMessage: errorMessage,
    url,
    description,
  });
}

export function onPlaywrightGenStream(
  callback: (event: PlaywrightGenStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlaywrightGenStreamEvent>("playwright-gen-stream", (event) => {
    callback(event.payload);
  });
}

// ─── Agent Personas ─────────────────────────────────────────────────────────

export interface AgentPersona {
  id: string;
  name: string;
  department: string;
  description: string;
  color: string;
  tools: string[];
  system_prompt: string;
}

export async function listAgentPersonas(): Promise<{ personas: AgentPersona[] }> {
  return safeInvoke("list_agent_personas");
}

export async function createAgentPersona(
  department: string,
  id: string,
  name: string,
  description: string,
  color: string,
  tools: string,
  systemPrompt: string
): Promise<void> {
  await safeInvoke("create_agent_persona", {
    department,
    id,
    name,
    description,
    color,
    tools,
    systemPrompt: systemPrompt,
  });
}

export async function updateAgentPersona(
  department: string,
  id: string,
  opts: {
    name?: string;
    description?: string;
    color?: string;
    tools?: string;
    systemPrompt?: string;
  }
): Promise<void> {
  await safeInvoke("update_agent_persona", {
    department,
    id,
    name: opts.name ?? null,
    description: opts.description ?? null,
    color: opts.color ?? null,
    tools: opts.tools ?? null,
    systemPrompt: opts.systemPrompt ?? null,
  });
}

export async function deleteAgentPersona(
  department: string,
  id: string
): Promise<void> {
  await safeInvoke("delete_agent_persona", { department, id });
}
