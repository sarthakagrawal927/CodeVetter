/** Agent adapter types for CodeVetter Desktop Mission Control */

export type AgentType = 'claude-code' | 'codex';

export type AgentInstallation = {
  name: string;
  type: AgentType;
  version: string;
  cliPath: string;
  historyDir: string;
};

export type LaunchOpts = {
  projectPath: string;
  task?: string;
  role?: string;
  model?: string;
};

export type AgentProcess = {
  id: string;
  agentType: AgentType;
  pid: number;
  projectPath: string;
  sessionId?: string;
  role?: string;
  displayName: string;
  status: 'running' | 'paused' | 'stopped' | 'completed';
  startedAt: string;
};

export type ActiveSession = {
  id: string;
  agentType: AgentType;
  projectPath: string;
  pid?: number;
  lastActivity: string;
};

export type SessionMessage = {
  id: string;
  parentUuid?: string;
  type: string;
  role?: string;
  contentText?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  timestamp: string;
  isSidechain: boolean;
};

export type ReviewOpts = {
  tone?: string;
  model?: string;
};

export type AgentReviewResult = {
  score: number;
  findings: Array<{
    severity: string;
    title: string;
    summary: string;
    suggestion?: string;
    filePath?: string;
    line?: number;
    confidence?: number;
    fingerprint: string;
  }>;
  summaryMarkdown: string;
  reviewAction: string;
};

/** The agent adapter interface — implementations must provide all methods */
export interface AgentAdapter {
  readonly name: AgentType;

  /** Detect if the agent CLI is installed and return installation info */
  detectInstallation(): Promise<AgentInstallation | null>;

  /** Get the directory where this agent stores session history */
  getHistoryDir(): string;

  /** Parse a session file into an async stream of messages */
  parseSessionFile(path: string): AsyncIterable<SessionMessage>;

  /** Launch a new agent session */
  launchSession(opts: LaunchOpts): Promise<AgentProcess>;

  /** Resume an existing agent session */
  resumeSession(sessionId: string): Promise<AgentProcess>;

  /** Run a one-shot review using this agent as the LLM backend */
  runReview(
    diff: string,
    files: Array<{ path: string; status: string }>,
    opts: ReviewOpts
  ): Promise<AgentReviewResult>;

  /** List currently active sessions for this agent type */
  listActiveSessions(): Promise<ActiveSession[]>;

  /** Kill a running agent session by PID */
  killSession(pid: number): Promise<void>;
}
