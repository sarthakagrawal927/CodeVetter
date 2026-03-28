/**
 * Review Feedback Loop — the core CodeVetter differentiator.
 *
 * Flow:
 * 1. Task moves to "Review" column
 * 2. Auto-run review-core on the task's repo
 * 3. If score < threshold → build fix instructions from findings → re-launch agent
 * 4. Agent fixes → task moves back to "Review" → repeat from step 2
 * 5. If score >= threshold OR max attempts reached → task moves to "Done"
 */

import { reviewLocalDiff, reviewPullRequest, loadReviewConfig, type ReviewResult } from "./review-service";
import { updateTask, launchAgent, getLocalDiff, listWorkspaces, getPreference, getGitRemoteInfo } from "./tauri-ipc";
import type { Task, WorkspaceRow } from "./tauri-ipc";

// ─── Config ─────────────────────────────────────────────────────────────────

const PASS_THRESHOLD = 80;
const MAX_ATTEMPTS = 3;

// ─── Build fix instructions from findings ───────────────────────────────────

function buildFixPrompt(result: ReviewResult, attempt: number): string {
  const findingsList = result.findings
    .map((f, i) => {
      let line = `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`;
      if (f.filePath) line += ` (${f.filePath}${f.line ? `:${f.line}` : ""})`;
      line += `\n   ${f.summary}`;
      if (f.suggestion) line += `\n   Fix: ${f.suggestion}`;
      return line;
    })
    .join("\n\n");

  return [
    `CODE REVIEW FAILED (attempt ${attempt}/${MAX_ATTEMPTS}, score: ${result.score}/100)`,
    "",
    "Fix ALL of the following issues. Do not add unnecessary code, abstractions, or comments.",
    "Make the minimum change needed to address each finding.",
    "",
    "Findings:",
    findingsList,
    "",
    "After fixing, commit your changes.",
  ].join("\n");
}

// ─── Loop state ─────────────────────────────────────────────────────────────

export interface LoopState {
  taskId: string;
  status: "idle" | "reviewing" | "waiting_for_fix" | "passed" | "failed_max_attempts";
  attempt: number;
  maxAttempts: number;
  lastScore: number | null;
  lastFindingsCount: number | null;
  reviewHistory: Array<{
    attempt: number;
    score: number;
    findingsCount: number;
    timestamp: string;
  }>;
  error: string | null;
}

// Track active loops
const activeLoops = new Map<string, LoopState>();

export function getLoopState(taskId: string): LoopState | null {
  return activeLoops.get(taskId) ?? null;
}

export function getAllActiveLoops(): LoopState[] {
  return Array.from(activeLoops.values());
}

// ─── Main loop entry point ──────────────────────────────────────────────────

/**
 * Start the review feedback loop for a task.
 * Called when a task moves to the "Review" column.
 */
export async function startReviewLoop(
  task: Task,
  onStateChange?: (state: LoopState) => void,
): Promise<LoopState> {
  if (!task.project_path) {
    throw new Error("Task has no project path — cannot review.");
  }

  const config = loadReviewConfig();
  if (!config) {
    throw new Error("No AI provider configured. Go to Settings to add your API key.");
  }

  // Initialize loop state
  const state: LoopState = {
    taskId: task.id,
    status: "reviewing",
    attempt: 1,
    maxAttempts: MAX_ATTEMPTS,
    lastScore: null,
    lastFindingsCount: null,
    reviewHistory: [],
    error: null,
  };
  activeLoops.set(task.id, state);
  onStateChange?.(state);

  try {
    return await runLoop(task, config, state, onStateChange);
  } catch (err) {
    state.status = "failed_max_attempts";
    state.error = err instanceof Error ? err.message : String(err);
    onStateChange?.(state);
    return state;
  }
}

/** Find a workspace matching this task's project path that has a PR linked. */
async function findLinkedPr(
  projectPath: string
): Promise<{ workspace: WorkspaceRow; owner: string; repo: string; pat: string } | null> {
  try {
    const workspaces = await listWorkspaces();
    const ws = workspaces.find(
      (w) => w.repo_path === projectPath && w.pr_number != null
    );
    if (!ws || !ws.pr_number) return null;

    const pat = await getPreference("github_token");
    if (!pat) return null;

    const remote = await getGitRemoteInfo(projectPath);
    if (!remote?.owner || !remote?.repo) return null;

    return { workspace: ws, owner: remote.owner, repo: remote.repo, pat };
  } catch {
    return null;
  }
}

async function runLoop(
  task: Task,
  config: ReturnType<typeof loadReviewConfig>,
  state: LoopState,
  onStateChange?: (state: LoopState) => void,
): Promise<LoopState> {
  if (!config || !task.project_path) throw new Error("Missing config or project path");

  // Step 1: Check if workspace has a linked PR → use PR review
  const linkedPr = await findLinkedPr(task.project_path);

  if (!linkedPr) {
    // No PR — check if there's a local diff to review
    const diff = await getLocalDiff(task.project_path);
    if (diff.empty) {
      state.status = "passed";
      state.lastScore = 100;
      state.lastFindingsCount = 0;
      await updateTask(task.id, "done").catch(() => {});
      onStateChange?.(state);
      activeLoops.delete(task.id);
      return state;
    }
  }

  // Step 2: Run review (PR or local diff)
  state.status = "reviewing";
  onStateChange?.(state);

  const result: ReviewResult = linkedPr
    ? await reviewPullRequest(
        linkedPr.owner,
        linkedPr.repo,
        linkedPr.workspace.pr_number!,
        linkedPr.pat,
        config,
        undefined,
        linkedPr.workspace.id,
      )
    : await reviewLocalDiff(task.project_path, config);

  state.lastScore = result.score;
  state.lastFindingsCount = result.findings.length;
  state.reviewHistory.push({
    attempt: state.attempt,
    score: result.score,
    findingsCount: result.findings.length,
    timestamp: new Date().toISOString(),
  });
  onStateChange?.(state);

  // Step 3: Check if passed
  if (result.score >= PASS_THRESHOLD) {
    state.status = "passed";
    await updateTask(task.id, "done").catch(() => {});
    onStateChange?.(state);
    activeLoops.delete(task.id);
    return state;
  }

  // Step 4: Check max attempts
  if (state.attempt >= MAX_ATTEMPTS) {
    state.status = "failed_max_attempts";
    state.error = `Failed after ${MAX_ATTEMPTS} attempts. Last score: ${result.score}`;
    onStateChange?.(state);
    activeLoops.delete(task.id);
    return state;
  }

  // Step 5: Send findings back to agent
  state.status = "waiting_for_fix";
  state.attempt += 1;
  onStateChange?.(state);

  const fixPrompt = buildFixPrompt(result, state.attempt - 1);
  const agentRole = task.assigned_agent || "code-fixer";

  await launchAgent(
    "claude-code",
    task.project_path,
    agentRole,
    fixPrompt,
  );

  // The agent is now running. The loop continues when the task
  // moves back to "Review" (triggered by the Board page or agent monitor).
  // We leave the state as "waiting_for_fix" — the Board page will call
  // continueReviewLoop() when the agent finishes and the task is back in Review.

  return state;
}

/**
 * Continue the loop after the agent has finished fixing.
 * Called when a task returns to "Review" status after a fix attempt.
 */
export async function continueReviewLoop(
  task: Task,
  onStateChange?: (state: LoopState) => void,
): Promise<LoopState> {
  const existing = activeLoops.get(task.id);
  if (!existing || existing.status !== "waiting_for_fix") {
    // No active loop — start a fresh one
    return startReviewLoop(task, onStateChange);
  }

  const config = loadReviewConfig();
  if (!config || !task.project_path) {
    existing.status = "failed_max_attempts";
    existing.error = "Missing config or project path";
    onStateChange?.(existing);
    return existing;
  }

  return runLoop(task, config, existing, onStateChange);
}

/**
 * Cancel an active review loop.
 */
export function cancelReviewLoop(taskId: string): void {
  activeLoops.delete(taskId);
}
