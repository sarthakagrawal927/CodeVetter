/**
 * DataProvider — abstraction layer between UI and backend.
 *
 * TauriProvider: calls Tauri IPC commands (desktop app)
 * HttpProvider:  calls REST API (web app)
 *
 * The UI imports from this module instead of tauri-ipc directly.
 * At app init, the appropriate provider is set based on environment.
 */

import type {
  LocalReviewRow,
  LocalReviewFindingRow,
  SessionRow,
  AgentProcess,
  AgentTaskRow,
  WorkspaceRow,
  IndexStats,
  ActivityRow,
} from "./tauri-ipc";

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface DataProvider {
  readonly type: "tauri" | "http";

  // Reviews
  listReviews(limit?: number, offset?: number, repoPath?: string): Promise<LocalReviewRow[]>;
  getReview(id: string): Promise<{ review: LocalReviewRow; findings: LocalReviewFindingRow[] }>;

  // Sessions
  listSessions(query?: string, project?: string, limit?: number, offset?: number): Promise<SessionRow[]>;

  // Agents
  listAgents(): Promise<AgentProcess[]>;
  launchAgent(adapter: string, projectPath: string, role?: string, task?: string, reviewId?: string, resumeSessionId?: string): Promise<{ agent_id: string; status: string }>;
  stopAgent(agentId: string): Promise<void>;

  // Tasks
  listTasks(status?: string): Promise<AgentTaskRow[]>;
  createTask(title: string, description: string, acceptanceCriteria?: string, projectPath?: string, workspaceId?: string): Promise<string>;
  updateTask(id: string, status?: string, assignedAgent?: string): Promise<void>;

  // Workspaces
  listWorkspaces(statusFilter?: string): Promise<WorkspaceRow[]>;
  getWorkspace(id: string): Promise<{ workspace: WorkspaceRow }>;

  // Activity
  listActivity(agentId?: string, limit?: number): Promise<ActivityRow[]>;

  // Preferences
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string): Promise<void>;

  // Stats
  getIndexStats(): Promise<IndexStats>;
}

// ─── Tauri Provider ──────────────────────────────────────────────────────────

export class TauriProvider implements DataProvider {
  readonly type = "tauri" as const;

  async listReviews(limit?: number, offset?: number, repoPath?: string) {
    const { listReviews } = await import("./tauri-ipc");
    return listReviews(limit, offset, repoPath);
  }

  async getReview(id: string) {
    const { getReview } = await import("./tauri-ipc");
    return getReview(id);
  }

  async listSessions(query?: string, project?: string, limit?: number, offset?: number) {
    const { listSessions } = await import("./tauri-ipc");
    return listSessions(query, project, limit, offset);
  }

  async listAgents() {
    const { listAgents } = await import("./tauri-ipc");
    return listAgents();
  }

  async launchAgent(adapter: string, projectPath: string, role?: string, task?: string, reviewId?: string, resumeSessionId?: string) {
    const { launchAgent } = await import("./tauri-ipc");
    return launchAgent(adapter, projectPath, role, task, reviewId, resumeSessionId);
  }

  async stopAgent(agentId: string) {
    const { stopAgent } = await import("./tauri-ipc");
    await stopAgent(agentId);
  }

  async listTasks(status?: string) {
    const { listTasks } = await import("./tauri-ipc");
    return listTasks(status);
  }

  async createTask(title: string, description: string, acceptanceCriteria?: string, projectPath?: string, workspaceId?: string) {
    const { createTask } = await import("./tauri-ipc");
    return createTask(title, description, acceptanceCriteria, projectPath, workspaceId);
  }

  async updateTask(id: string, status?: string, assignedAgent?: string) {
    const { updateTask } = await import("./tauri-ipc");
    await updateTask(id, status, assignedAgent);
  }

  async listWorkspaces(statusFilter?: string) {
    const { listWorkspaces } = await import("./tauri-ipc");
    return listWorkspaces(statusFilter);
  }

  async getWorkspace(id: string) {
    const { getWorkspace } = await import("./tauri-ipc");
    return getWorkspace(id);
  }

  async listActivity(agentId?: string, limit?: number) {
    const { listActivity } = await import("./tauri-ipc");
    return listActivity(agentId, limit);
  }

  async getPreference(key: string) {
    const { getPreference } = await import("./tauri-ipc");
    return getPreference(key);
  }

  async setPreference(key: string, value: string) {
    const { setPreference } = await import("./tauri-ipc");
    await setPreference(key, value);
  }

  async getIndexStats() {
    const { getIndexStats } = await import("./tauri-ipc");
    return getIndexStats();
  }
}

// ─── HTTP Provider (Web App) ─────────────────────────────────────────────────

export class HttpProvider implements DataProvider {
  readonly type = "http" as const;
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  setAuthToken(token: string) {
    this.authToken = token;
  }

  private async fetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers: { ...headers, ...opts?.headers },
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async listReviews(limit = 50, offset = 0, repoPath?: string) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (repoPath) params.set("repoPath", repoPath);
    return this.fetch<LocalReviewRow[]>(`/api/reviews?${params}`);
  }

  async getReview(id: string) {
    return this.fetch<{ review: LocalReviewRow; findings: LocalReviewFindingRow[] }>(`/api/reviews/${id}`);
  }

  async listSessions(query?: string, project?: string, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (query) params.set("q", query);
    if (project) params.set("project", project);
    return this.fetch<SessionRow[]>(`/api/sessions?${params}`);
  }

  async listAgents() {
    return this.fetch<AgentProcess[]>("/api/agents");
  }

  async launchAgent(adapter: string, projectPath: string, role?: string, task?: string) {
    return this.fetch<{ agent_id: string; status: string }>("/api/agents", {
      method: "POST",
      body: JSON.stringify({ adapter, projectPath, role, task }),
    });
  }

  async stopAgent(agentId: string) {
    await this.fetch(`/api/agents/${agentId}/stop`, { method: "POST" });
  }

  async listTasks(status?: string) {
    const params = status ? `?status=${status}` : "";
    return this.fetch<AgentTaskRow[]>(`/api/tasks${params}`);
  }

  async createTask(title: string, description: string, acceptanceCriteria?: string, projectPath?: string, workspaceId?: string) {
    const resp = await this.fetch<{ task_id: string }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, description, acceptanceCriteria, projectPath, workspaceId }),
    });
    return resp.task_id;
  }

  async updateTask(id: string, status?: string, assignedAgent?: string) {
    await this.fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, assignedAgent }),
    });
  }

  async listWorkspaces(statusFilter?: string) {
    const params = statusFilter ? `?status=${statusFilter}` : "";
    return this.fetch<WorkspaceRow[]>(`/api/workspaces${params}`);
  }

  async getWorkspace(id: string) {
    return this.fetch<{ workspace: WorkspaceRow }>(`/api/workspaces/${id}`);
  }

  async listActivity(agentId?: string, limit = 100) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (agentId) params.set("agentId", agentId);
    return this.fetch<ActivityRow[]>(`/api/activity?${params}`);
  }

  async getPreference(key: string) {
    try {
      const resp = await this.fetch<{ value: string | null }>(`/api/preferences/${key}`);
      return resp.value;
    } catch {
      return null;
    }
  }

  async setPreference(key: string, value: string) {
    await this.fetch(`/api/preferences/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  async getIndexStats() {
    return this.fetch<IndexStats>("/api/stats");
  }
}

// ─── Provider singleton ──────────────────────────────────────────────────────

let _provider: DataProvider | null = null;

export function getProvider(): DataProvider {
  if (!_provider) {
    // Auto-detect: if Tauri is available, use TauriProvider; otherwise HttpProvider
    if (
      typeof window !== "undefined" &&
      typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== "undefined"
    ) {
      _provider = new TauriProvider();
    } else {
      _provider = new HttpProvider(
        import.meta.env.VITE_API_URL || "/api"
      );
    }
  }
  return _provider;
}

export function setProvider(provider: DataProvider): void {
  _provider = provider;
}
