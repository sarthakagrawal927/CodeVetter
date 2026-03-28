/**
 * Symphony-style Agent Orchestrator
 *
 * Defines multi-step workflows for agent tasks:
 *   plan → code → review → test → done
 *
 * Each step launches an agent with a specific role/prompt.
 * If a step fails, it retries up to maxRetries times.
 * The orchestrator auto-advances tasks through the pipeline.
 */

import { launchAgent, updateTask, getPreference } from "./tauri-ipc";
import { reviewLocalDiff, loadReviewConfig } from "./review-service";
import type { Task } from "./tauri-ipc";

// ─── Workflow Definition ──────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  label: string;
  /** Task status to set when this step starts */
  status: string;
  /** Agent role to launch */
  agentRole: string;
  /** Prompt builder — receives the task and returns the agent prompt */
  buildPrompt: (task: Task, context?: StepContext) => string;
  /** Optional: validate step output before advancing */
  validate?: (task: Task) => Promise<StepValidation>;
  /** Max retries for this step (default 2) */
  maxRetries?: number;
}

export interface StepContext {
  previousStepOutput?: string;
  attempt: number;
  error?: string;
}

export interface StepValidation {
  passed: boolean;
  reason?: string;
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

// ─── Built-in Workflows ──────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW: Workflow = {
  id: "default",
  name: "Plan → Code → Review",
  steps: [
    {
      id: "plan",
      label: "Planning",
      status: "in_progress",
      agentRole: "planner",
      buildPrompt: (task) =>
        [
          `TASK: ${task.title}`,
          task.description ? `\nDESCRIPTION: ${task.description}` : "",
          task.acceptance_criteria ? `\nACCEPTANCE CRITERIA: ${task.acceptance_criteria}` : "",
          "",
          "Create a detailed implementation plan for this task.",
          "Break it into concrete steps. Identify files to create/modify.",
          "Do NOT write code yet — just plan.",
          "Write the plan as comments in a PLAN.md file, then commit it.",
        ].join("\n"),
      maxRetries: 1,
    },
    {
      id: "code",
      label: "Coding",
      status: "in_progress",
      agentRole: "coder",
      buildPrompt: (task) =>
        [
          `TASK: ${task.title}`,
          task.description ? `\nDESCRIPTION: ${task.description}` : "",
          task.acceptance_criteria ? `\nACCEPTANCE CRITERIA: ${task.acceptance_criteria}` : "",
          "",
          "Implement this task. Follow any existing PLAN.md if present.",
          "Write minimal, focused code. No over-engineering.",
          "Commit your changes when done.",
        ].join("\n"),
      maxRetries: 2,
    },
    {
      id: "review",
      label: "Review",
      status: "in_review",
      agentRole: "reviewer",
      buildPrompt: () => "", // Review step uses review-core, not an agent
      validate: async (task) => {
        const config = loadReviewConfig();
        if (!config || !task.project_path) {
          return { passed: true, reason: "No review config — skipping" };
        }
        try {
          const result = await reviewLocalDiff(task.project_path, config);
          return {
            passed: result.score >= 80,
            reason: result.score >= 80
              ? `Score: ${result.score}`
              : `Score: ${result.score} — needs fixes`,
          };
        } catch {
          return { passed: true, reason: "Review failed — skipping" };
        }
      },
      maxRetries: 3,
    },
  ],
};

export const CODE_ONLY_WORKFLOW: Workflow = {
  id: "code-only",
  name: "Code → Review",
  steps: [
    DEFAULT_WORKFLOW.steps[1], // code
    DEFAULT_WORKFLOW.steps[2], // review
  ],
};

export const WORKFLOWS: Workflow[] = [DEFAULT_WORKFLOW, CODE_ONLY_WORKFLOW];

// ─── Orchestrator State ──────────────────────────────────────────────────────

export interface OrchestratorState {
  taskId: string;
  workflowId: string;
  currentStepIndex: number;
  stepAttempts: number;
  status: "running" | "completed" | "failed" | "paused";
  stepHistory: Array<{
    stepId: string;
    attempt: number;
    result: "success" | "failed" | "skipped";
    timestamp: string;
    reason?: string;
  }>;
  error?: string;
}

const activeOrchestrations = new Map<string, OrchestratorState>();

export function getOrchestrationState(taskId: string): OrchestratorState | null {
  return activeOrchestrations.get(taskId) ?? null;
}

export function getAllOrchestrations(): OrchestratorState[] {
  return Array.from(activeOrchestrations.values());
}

export function cancelOrchestration(taskId: string): void {
  activeOrchestrations.delete(taskId);
}

// ─── Run Orchestration ───────────────────────────────────────────────────────

/**
 * Start a full workflow orchestration for a task.
 */
export async function startOrchestration(
  task: Task,
  workflow: Workflow = DEFAULT_WORKFLOW,
  onStateChange?: (state: OrchestratorState) => void,
): Promise<OrchestratorState> {
  if (!task.project_path) {
    throw new Error("Task has no project path — cannot orchestrate.");
  }

  const state: OrchestratorState = {
    taskId: task.id,
    workflowId: workflow.id,
    currentStepIndex: 0,
    stepAttempts: 0,
    status: "running",
    stepHistory: [],
  };
  activeOrchestrations.set(task.id, state);
  onStateChange?.(state);

  try {
    return await runWorkflow(task, workflow, state, onStateChange);
  } catch (err) {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : String(err);
    onStateChange?.(state);
    return state;
  }
}

async function runWorkflow(
  task: Task,
  workflow: Workflow,
  state: OrchestratorState,
  onStateChange?: (state: OrchestratorState) => void,
): Promise<OrchestratorState> {
  while (state.currentStepIndex < workflow.steps.length) {
    const step = workflow.steps[state.currentStepIndex];
    state.stepAttempts = 0;

    let stepPassed = false;

    while (state.stepAttempts < (step.maxRetries ?? 2)) {
      state.stepAttempts++;
      onStateChange?.(state);

      // Update task status
      await updateTask(task.id, step.status).catch(() => {});

      if (step.id === "review" && step.validate) {
        // Review step — run validation directly
        const validation = await step.validate(task);
        if (validation.passed) {
          state.stepHistory.push({
            stepId: step.id,
            attempt: state.stepAttempts,
            result: "success",
            timestamp: new Date().toISOString(),
            reason: validation.reason,
          });
          stepPassed = true;
          break;
        } else {
          state.stepHistory.push({
            stepId: step.id,
            attempt: state.stepAttempts,
            result: "failed",
            timestamp: new Date().toISOString(),
            reason: validation.reason,
          });
          // Launch fix agent
          if (state.stepAttempts < (step.maxRetries ?? 2)) {
            const fixPrompt = `The code review found issues: ${validation.reason}\nFix the issues and commit.`;
            await launchAgent("claude-code", task.project_path!, "code-fixer", fixPrompt);
            // Wait for agent to finish (simple polling)
            await waitForAgentCompletion(task.project_path!);
          }
        }
      } else {
        // Normal step — launch agent
        const context: StepContext = {
          attempt: state.stepAttempts,
          error: state.stepHistory.length > 0
            ? state.stepHistory[state.stepHistory.length - 1].reason
            : undefined,
        };
        const prompt = step.buildPrompt(task, context);
        await launchAgent("claude-code", task.project_path!, step.agentRole, prompt);
        // Wait for agent to finish
        await waitForAgentCompletion(task.project_path!);

        // Validate if validator exists
        if (step.validate) {
          const validation = await step.validate(task);
          if (validation.passed) {
            state.stepHistory.push({
              stepId: step.id,
              attempt: state.stepAttempts,
              result: "success",
              timestamp: new Date().toISOString(),
              reason: validation.reason,
            });
            stepPassed = true;
            break;
          } else {
            state.stepHistory.push({
              stepId: step.id,
              attempt: state.stepAttempts,
              result: "failed",
              timestamp: new Date().toISOString(),
              reason: validation.reason,
            });
          }
        } else {
          // No validator — assume success
          state.stepHistory.push({
            stepId: step.id,
            attempt: state.stepAttempts,
            result: "success",
            timestamp: new Date().toISOString(),
          });
          stepPassed = true;
          break;
        }
      }
    }

    if (!stepPassed) {
      state.status = "failed";
      state.error = `Step "${step.label}" failed after ${step.maxRetries ?? 2} attempts`;
      onStateChange?.(state);
      activeOrchestrations.delete(task.id);
      return state;
    }

    state.currentStepIndex++;
    onStateChange?.(state);
  }

  // All steps passed
  state.status = "completed";
  await updateTask(task.id, "done").catch(() => {});
  onStateChange?.(state);
  activeOrchestrations.delete(task.id);
  return state;
}

/**
 * Simple agent completion wait — polls for process exit.
 * In production, this would use events/callbacks from the agent monitor.
 */
async function waitForAgentCompletion(projectPath: string): Promise<void> {
  const { detectRunningAgents } = await import("./tauri-ipc");
  const maxWait = 10 * 60 * 1000; // 10 minutes max
  const pollInterval = 5000; // 5 seconds
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    try {
      const agents = await detectRunningAgents();
      const running = agents.some((a) => a.command.includes(projectPath));
      if (!running) return;
    } catch {
      return;
    }
  }
}
