import {
  AuditLogRecord,
  GitHubInstallationRecord,
  GitHubWebhookEnvelope,
  IndexedFileRecord,
  IndexingJobRecord,
  PullRequestRecord,
  RepositoryConnection,
  RepositoryRuleOverride,
  RepositoryUsageRecord,
  ReviewFindingRecord,
  ReviewRunRecord,
  SemanticChunkRecord,
  SemanticIndexBatch,
  SessionRecord,
  UserRecord,
  WorkspaceInviteRecord,
  WorkspaceMemberRecord,
  WorkspaceRecord,
  WorkspaceRuleDefaults,
  WorkspaceSecretRecord
} from '@code-reviewer/shared-types';

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compareIsoDesc(left: string | undefined, right: string | undefined): number {
  return (right || '').localeCompare(left || '');
}

export type UpsertGithubUserInput = {
  githubUserId: string;
  githubLogin: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
};

export type CreateSessionInput = {
  userId: string;
  sessionTokenHash: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
};

export type CreateWorkspaceInput = {
  slug: string;
  name: string;
  kind: WorkspaceRecord['kind'];
  githubAccountType?: WorkspaceRecord['githubAccountType'];
  githubAccountId?: string;
  createdByUserId: string;
};

export type AddWorkspaceMemberInput = {
  workspaceId: string;
  userId: string;
  githubUserId: string;
  githubLogin: string;
  role: WorkspaceMemberRecord['role'];
  status: WorkspaceMemberRecord['status'];
  invitedByUserId?: string;
};

export type CreateWorkspaceInviteInput = {
  workspaceId: string;
  inviteTokenHash: string;
  inviteeGithubLogin?: string;
  inviteeEmail?: string;
  role: WorkspaceInviteRecord['role'];
  invitedByUserId: string;
  expiresAt: string;
};

export type UpsertGitHubInstallationInput = {
  workspaceId: string;
  installationId: string;
  accountType: GitHubInstallationRecord['accountType'];
  accountId: string;
  accountLogin?: string;
};

export type UpsertRepositoryInput = {
  workspaceId: string;
  provider: RepositoryConnection['provider'];
  owner: string;
  name: string;
  fullName: string;
  githubRepoId?: string;
  installationId?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  isActive: boolean;
};

export type UpsertPullRequestInput = {
  repositoryId: string;
  githubPrId?: string;
  prNumber: number;
  title?: string;
  authorGithubLogin?: string;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  state: PullRequestRecord['state'];
  isAgentAuthored?: boolean;
  agentName?: string;
  mergedAt?: string;
  closedAt?: string;
};

export type CreateReviewRunInput = {
  repositoryId: string;
  pullRequestId?: string;
  prNumber: number;
  headSha: string;
  triggerSource?: ReviewRunRecord['triggerSource'];
  status: ReviewRunRecord['status'];
  reviewMode?: ReviewRunRecord['reviewMode'];
  reviewAction?: ReviewRunRecord['reviewAction'];
  parentReviewRunId?: string;
  scoreVersion?: string;
  startedAt?: string;
};

export type UpsertWorkspaceRulesInput = Omit<WorkspaceRuleDefaults, 'updatedAt'> & {
  updatedAt?: string;
};

export type UpsertRepositoryRuleOverrideInput = Omit<RepositoryRuleOverride, 'updatedAt'> & {
  updatedAt?: string;
};

export type CreateIndexingRunInput = {
  repositoryId: string;
  status: IndexingJobRecord['status'];
  sourceRef?: string;
  summary?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type CreateAuditLogInput = Omit<AuditLogRecord, 'id' | 'createdAt'> & {
  createdAt?: string;
};

export type UpsertWorkspaceSecretInput = Omit<WorkspaceSecretRecord, 'id' | 'createdAt' | 'updatedAt'>;

export type UpdateReviewRunPatch = Partial<
  Pick<
    ReviewRunRecord,
    'status' | 'scoreComposite' | 'findingsCount' | 'completedAt' | 'errorMessage' | 'scoreVersion' | 'reviewAction'
  >
>;

export type UpdateIndexingRunPatch = Partial<
  Pick<IndexingJobRecord, 'status' | 'summary' | 'completedAt' | 'errorMessage'>
>;

export interface ControlPlaneDatabase {
  upsertUserFromGithub(input: UpsertGithubUserInput): Promise<UserRecord>;
  getUserById(userId: string): Promise<UserRecord | undefined>;
  getUserByGithubId(githubUserId: string): Promise<UserRecord | undefined>;
  listUsers(): Promise<UserRecord[]>;

  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  getSessionByTokenHash(sessionTokenHash: string): Promise<SessionRecord | undefined>;
  revokeSession(sessionId: string): Promise<SessionRecord | undefined>;

  listWorkspacesForUser(userId: string): Promise<WorkspaceRecord[]>;
  listAllWorkspaces(): Promise<WorkspaceRecord[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | undefined>;
  getWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | undefined>;

  addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMemberRecord>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMemberRecord | undefined>;
  updateWorkspaceMember(
    workspaceId: string,
    memberId: string,
    patch: Partial<Pick<WorkspaceMemberRecord, 'role' | 'status'>>
  ): Promise<WorkspaceMemberRecord | undefined>;

  createWorkspaceInvite(input: CreateWorkspaceInviteInput): Promise<WorkspaceInviteRecord>;
  getWorkspaceInviteByTokenHash(tokenHash: string): Promise<WorkspaceInviteRecord | undefined>;
  consumeWorkspaceInvite(inviteId: string, acceptedByUserId: string): Promise<WorkspaceInviteRecord | undefined>;

  listGitHubInstallations(workspaceId: string): Promise<GitHubInstallationRecord[]>;
  upsertGitHubInstallation(input: UpsertGitHubInstallationInput): Promise<GitHubInstallationRecord>;

  listRepositories(workspaceId: string): Promise<RepositoryConnection[]>;
  listAllRepositories(): Promise<RepositoryConnection[]>;
  upsertRepository(input: UpsertRepositoryInput): Promise<RepositoryConnection>;
  getRepositoryById(repositoryId: string): Promise<RepositoryConnection | undefined>;
  getRepositoryByFullName(workspaceId: string, fullName: string): Promise<RepositoryConnection | undefined>;

  getWorkspaceRuleDefaults(workspaceId: string): Promise<WorkspaceRuleDefaults | undefined>;
  upsertWorkspaceRuleDefaults(input: UpsertWorkspaceRulesInput): Promise<WorkspaceRuleDefaults>;
  getRepositoryRuleOverride(repositoryId: string): Promise<RepositoryRuleOverride | undefined>;
  upsertRepositoryRuleOverride(input: UpsertRepositoryRuleOverrideInput): Promise<RepositoryRuleOverride>;

  upsertPullRequest(input: UpsertPullRequestInput): Promise<PullRequestRecord>;
  getPullRequestById(pullRequestId: string): Promise<PullRequestRecord | undefined>;
  listPullRequestsByRepository(repositoryId: string): Promise<PullRequestRecord[]>;

  createReviewRun(input: CreateReviewRunInput): Promise<ReviewRunRecord>;
  getReviewRunById(reviewRunId: string): Promise<ReviewRunRecord | undefined>;
  updateReviewRun(reviewRunId: string, patch: UpdateReviewRunPatch): Promise<ReviewRunRecord | undefined>;
  listReviewRunsByPullRequest(pullRequestId: string): Promise<ReviewRunRecord[]>;
  listReviewRunsByRepository(repositoryId: string): Promise<ReviewRunRecord[]>;

  addReviewFinding(
    input: Omit<ReviewFindingRecord, 'id' | 'createdAt'> & { createdAt?: string }
  ): Promise<ReviewFindingRecord>;
  listReviewFindingsByRun(reviewRunId: string): Promise<ReviewFindingRecord[]>;
  updateReviewFinding(
    findingId: string,
    patch: Partial<Pick<ReviewFindingRecord, 'status'>>
  ): Promise<ReviewFindingRecord | undefined>;
  getLatestCompletedReviewRun(pullRequestId: string): Promise<ReviewRunRecord | undefined>;

  createIndexingRun(input: CreateIndexingRunInput): Promise<IndexingJobRecord>;
  updateIndexingRun(indexingRunId: string, patch: UpdateIndexingRunPatch): Promise<IndexingJobRecord | undefined>;
  listIndexingRunsByRepository(repositoryId: string): Promise<IndexingJobRecord[]>;

  getWebhookEventByDeliveryId(provider: string, deliveryId: string): Promise<GitHubWebhookEnvelope | undefined>;
  recordWebhookEvent(input: GitHubWebhookEnvelope): Promise<GitHubWebhookEnvelope>;
  updateWebhookEvent(
    provider: string,
    deliveryId: string,
    patch: Partial<Pick<GitHubWebhookEnvelope, 'processingStatus' | 'processedAt' | 'signatureValid'>>
  ): Promise<GitHubWebhookEnvelope | undefined>;

  appendAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord>;
  listAuditLogs(workspaceId: string, limit?: number): Promise<AuditLogRecord[]>;

  upsertWorkspaceSecret(input: UpsertWorkspaceSecretInput): Promise<WorkspaceSecretRecord>;
  getWorkspaceSecret(workspaceId: string, kind: WorkspaceSecretRecord['kind']): Promise<WorkspaceSecretRecord | undefined>;

  saveIndexBatch(batch: SemanticIndexBatch): Promise<{ filesCreated: number; chunksCreated: number }>;
  listIndexedFiles(repositoryId: string, sourceRef?: string): Promise<IndexedFileRecord[]>;
  listSemanticChunks(repositoryId: string, sourceRef: string): Promise<SemanticChunkRecord[]>;
  deleteIndexedData(repositoryId: string, sourceRef?: string): Promise<{ filesDeleted: number; chunksDeleted: number }>;
  getIndexingStats(repositoryId: string): Promise<{ totalFiles: number; totalChunks: number; languages: Record<string, number>; lastIndexedAt?: string }>;

  getRepositoryUsage(repositoryId: string, period: string): Promise<RepositoryUsageRecord | undefined>;
  incrementRepositoryUsage(repositoryId: string, period: string): Promise<RepositoryUsageRecord>;

  getWorkspaceForRepository(repositoryId: string): Promise<WorkspaceRecord | undefined>;
}

export class InMemoryControlPlaneDatabase implements ControlPlaneDatabase {
  private users = new Map<string, UserRecord>();
  private sessions = new Map<string, SessionRecord>();
  private workspaces = new Map<string, WorkspaceRecord>();
  private workspaceMembers = new Map<string, WorkspaceMemberRecord>();
  private workspaceInvites = new Map<string, WorkspaceInviteRecord>();
  private githubInstallations = new Map<string, GitHubInstallationRecord>();
  private repositories = new Map<string, RepositoryConnection>();
  private workspaceRuleDefaults = new Map<string, WorkspaceRuleDefaults>();
  private repositoryRuleOverrides = new Map<string, RepositoryRuleOverride>();
  private pullRequests = new Map<string, PullRequestRecord>();
  private reviewRuns = new Map<string, ReviewRunRecord>();
  private reviewFindings = new Map<string, ReviewFindingRecord>();
  private indexingRuns = new Map<string, IndexingJobRecord>();
  private webhookEvents = new Map<string, GitHubWebhookEnvelope>();
  private auditLogs: AuditLogRecord[] = [];
  private workspaceSecrets = new Map<string, WorkspaceSecretRecord>();
  private indexedFiles = new Map<string, IndexedFileRecord>();
  private semanticChunks = new Map<string, SemanticChunkRecord>();
  private repositoryUsage = new Map<string, RepositoryUsageRecord>();

  async upsertUserFromGithub(input: UpsertGithubUserInput): Promise<UserRecord> {
    const existing = Array.from(this.users.values()).find(user => user.githubUserId === input.githubUserId);
    const timestamp = nowIso();

    const user: UserRecord = {
      id: existing?.id || id('usr'),
      githubUserId: input.githubUserId,
      githubLogin: input.githubLogin,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      email: input.email,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    this.users.set(user.id, user);
    return clone(user);
  }

  async getUserById(userId: string): Promise<UserRecord | undefined> {
    const user = this.users.get(userId);
    return user ? clone(user) : undefined;
  }

  async getUserByGithubId(githubUserId: string): Promise<UserRecord | undefined> {
    const user = Array.from(this.users.values()).find(item => item.githubUserId === githubUserId);
    return user ? clone(user) : undefined;
  }

  async listUsers(): Promise<UserRecord[]> {
    return clone(Array.from(this.users.values()));
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const timestamp = nowIso();
    const session: SessionRecord = {
      id: id('sess'),
      userId: input.userId,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.sessions.set(session.id, session);
    return clone(session);
  }

  async getSessionByTokenHash(sessionTokenHash: string): Promise<SessionRecord | undefined> {
    const session = Array.from(this.sessions.values()).find(item => item.sessionTokenHash === sessionTokenHash);
    return session ? clone(session) : undefined;
  }

  async revokeSession(sessionId: string): Promise<SessionRecord | undefined> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return undefined;
    }

    const next: SessionRecord = {
      ...existing,
      revokedAt: nowIso(),
      updatedAt: nowIso()
    };
    this.sessions.set(sessionId, next);
    return clone(next);
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceRecord[]> {
    const workspaceIds = Array.from(this.workspaceMembers.values())
      .filter(member => member.userId === userId && member.status === 'active')
      .map(member => member.workspaceId);

    const workspaces = workspaceIds
      .map(workspaceId => this.workspaces.get(workspaceId))
      .filter((workspace): workspace is WorkspaceRecord => Boolean(workspace))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return clone(workspaces);
  }

  async listAllWorkspaces(): Promise<WorkspaceRecord[]> {
    const workspaces = Array.from(this.workspaces.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return clone(workspaces);
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const duplicate = Array.from(this.workspaces.values()).find(workspace => workspace.slug === input.slug);
    if (duplicate) {
      throw new Error(`Workspace slug already exists: ${input.slug}`);
    }

    const timestamp = nowIso();
    const workspace: WorkspaceRecord = {
      id: id('ws'),
      slug: input.slug,
      name: input.name,
      kind: input.kind,
      tier: input.kind === 'oss_free' ? 'free' : 'free',
      githubAccountType: input.githubAccountType,
      githubAccountId: input.githubAccountId,
      createdByUserId: input.createdByUserId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.workspaces.set(workspace.id, workspace);

    await this.addWorkspaceMember({
      workspaceId: workspace.id,
      userId: input.createdByUserId,
      githubUserId: '',
      githubLogin: '',
      role: 'owner',
      status: 'active'
    });

    return clone(workspace);
  }

  async getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | undefined> {
    const workspace = this.workspaces.get(workspaceId);
    return workspace ? clone(workspace) : undefined;
  }

  async getWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | undefined> {
    const workspace = Array.from(this.workspaces.values()).find(item => item.slug === slug);
    return workspace ? clone(workspace) : undefined;
  }

  async addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMemberRecord> {
    const existing = Array.from(this.workspaceMembers.values()).find(
      member => member.workspaceId === input.workspaceId && member.userId === input.userId
    );
    const timestamp = nowIso();

    const member: WorkspaceMemberRecord = {
      id: existing?.id || id('wm'),
      workspaceId: input.workspaceId,
      userId: input.userId,
      githubUserId: input.githubUserId,
      githubLogin: input.githubLogin,
      role: input.role,
      status: input.status,
      invitedByUserId: input.invitedByUserId,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    this.workspaceMembers.set(member.id, member);
    return clone(member);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    const members = Array.from(this.workspaceMembers.values())
      .filter(member => member.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return clone(members);
  }

  async getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMemberRecord | undefined> {
    const member = Array.from(this.workspaceMembers.values()).find(
      item => item.workspaceId === workspaceId && item.userId === userId
    );
    return member ? clone(member) : undefined;
  }

  async updateWorkspaceMember(
    workspaceId: string,
    memberId: string,
    patch: Partial<Pick<WorkspaceMemberRecord, 'role' | 'status'>>
  ): Promise<WorkspaceMemberRecord | undefined> {
    const existing = this.workspaceMembers.get(memberId);
    if (!existing || existing.workspaceId !== workspaceId) {
      return undefined;
    }

    const next: WorkspaceMemberRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso()
    };

    this.workspaceMembers.set(memberId, next);
    return clone(next);
  }

  async createWorkspaceInvite(input: CreateWorkspaceInviteInput): Promise<WorkspaceInviteRecord> {
    const timestamp = nowIso();
    const invite: WorkspaceInviteRecord = {
      id: id('inv'),
      workspaceId: input.workspaceId,
      inviteTokenHash: input.inviteTokenHash,
      inviteeGithubLogin: input.inviteeGithubLogin,
      inviteeEmail: input.inviteeEmail,
      role: input.role,
      status: 'pending',
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.workspaceInvites.set(invite.id, invite);
    return clone(invite);
  }

  async getWorkspaceInviteByTokenHash(tokenHash: string): Promise<WorkspaceInviteRecord | undefined> {
    const invite = Array.from(this.workspaceInvites.values()).find(item => item.inviteTokenHash === tokenHash);
    return invite ? clone(invite) : undefined;
  }

  async consumeWorkspaceInvite(inviteId: string, acceptedByUserId: string): Promise<WorkspaceInviteRecord | undefined> {
    const existing = this.workspaceInvites.get(inviteId);
    if (!existing) {
      return undefined;
    }

    const next: WorkspaceInviteRecord = {
      ...existing,
      status: 'accepted',
      acceptedByUserId,
      updatedAt: nowIso()
    };

    this.workspaceInvites.set(inviteId, next);
    return clone(next);
  }

  async listGitHubInstallations(workspaceId: string): Promise<GitHubInstallationRecord[]> {
    const installations = Array.from(this.githubInstallations.values())
      .filter(item => item.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return clone(installations);
  }

  async upsertGitHubInstallation(input: UpsertGitHubInstallationInput): Promise<GitHubInstallationRecord> {
    const existing = Array.from(this.githubInstallations.values()).find(
      item => item.workspaceId === input.workspaceId && item.installationId === input.installationId
    );
    const timestamp = nowIso();

    const installation: GitHubInstallationRecord = {
      id: existing?.id || id('ghi'),
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      accountType: input.accountType,
      accountId: input.accountId,
      accountLogin: input.accountLogin,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    this.githubInstallations.set(installation.id, installation);
    return clone(installation);
  }

  async listRepositories(workspaceId: string): Promise<RepositoryConnection[]> {
    const repositories = Array.from(this.repositories.values())
      .filter(item => item.workspaceId === workspaceId)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return clone(repositories);
  }

  async listAllRepositories(): Promise<RepositoryConnection[]> {
    const repositories = Array.from(this.repositories.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
    return clone(repositories);
  }

  async upsertRepository(input: UpsertRepositoryInput): Promise<RepositoryConnection> {
    const existing = Array.from(this.repositories.values()).find(
      item => item.workspaceId === input.workspaceId && item.fullName === input.fullName
    );
    const timestamp = nowIso();

    const repository: RepositoryConnection = {
      id: existing?.id || id('repo'),
      workspaceId: input.workspaceId,
      provider: input.provider,
      owner: input.owner,
      name: input.name,
      fullName: input.fullName,
      githubRepoId: input.githubRepoId,
      installationId: input.installationId,
      defaultBranch: input.defaultBranch,
      isPrivate: input.isPrivate,
      isActive: input.isActive,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    this.repositories.set(repository.id, repository);
    return clone(repository);
  }

  async getRepositoryById(repositoryId: string): Promise<RepositoryConnection | undefined> {
    const repository = this.repositories.get(repositoryId);
    return repository ? clone(repository) : undefined;
  }

  async getRepositoryByFullName(workspaceId: string, fullName: string): Promise<RepositoryConnection | undefined> {
    const repository = Array.from(this.repositories.values()).find(
      item => item.workspaceId === workspaceId && item.fullName === fullName
    );
    return repository ? clone(repository) : undefined;
  }

  async getWorkspaceRuleDefaults(workspaceId: string): Promise<WorkspaceRuleDefaults | undefined> {
    const rules = this.workspaceRuleDefaults.get(workspaceId);
    return rules ? clone(rules) : undefined;
  }

  async upsertWorkspaceRuleDefaults(input: UpsertWorkspaceRulesInput): Promise<WorkspaceRuleDefaults> {
    const next: WorkspaceRuleDefaults = {
      ...input,
      updatedAt: input.updatedAt || nowIso()
    };

    this.workspaceRuleDefaults.set(input.workspaceId, next);
    return clone(next);
  }

  async getRepositoryRuleOverride(repositoryId: string): Promise<RepositoryRuleOverride | undefined> {
    const override = this.repositoryRuleOverrides.get(repositoryId);
    return override ? clone(override) : undefined;
  }

  async upsertRepositoryRuleOverride(input: UpsertRepositoryRuleOverrideInput): Promise<RepositoryRuleOverride> {
    const next: RepositoryRuleOverride = {
      ...input,
      updatedAt: input.updatedAt || nowIso()
    };

    this.repositoryRuleOverrides.set(input.repositoryId, next);
    return clone(next);
  }

  async upsertPullRequest(input: UpsertPullRequestInput): Promise<PullRequestRecord> {
    const existing = Array.from(this.pullRequests.values()).find(
      item => item.repositoryId === input.repositoryId && item.prNumber === input.prNumber
    );
    const timestamp = nowIso();

    const pullRequest: PullRequestRecord = {
      id: existing?.id || id('pr'),
      repositoryId: input.repositoryId,
      githubPrId: input.githubPrId,
      prNumber: input.prNumber,
      title: input.title,
      authorGithubLogin: input.authorGithubLogin,
      baseRef: input.baseRef,
      headRef: input.headRef,
      headSha: input.headSha,
      state: input.state,
      isAgentAuthored: input.isAgentAuthored ?? existing?.isAgentAuthored ?? false,
      agentName: input.agentName ?? existing?.agentName,
      mergedAt: input.mergedAt,
      closedAt: input.closedAt,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    this.pullRequests.set(pullRequest.id, pullRequest);
    return clone(pullRequest);
  }

  async getPullRequestById(pullRequestId: string): Promise<PullRequestRecord | undefined> {
    const pullRequest = this.pullRequests.get(pullRequestId);
    return pullRequest ? clone(pullRequest) : undefined;
  }

  async listPullRequestsByRepository(repositoryId: string): Promise<PullRequestRecord[]> {
    const pullRequests = Array.from(this.pullRequests.values())
      .filter(item => item.repositoryId === repositoryId)
      .sort((a, b) => b.prNumber - a.prNumber);
    return clone(pullRequests);
  }

  async createReviewRun(input: CreateReviewRunInput): Promise<ReviewRunRecord> {
    const run: ReviewRunRecord = {
      id: id('rr'),
      repositoryId: input.repositoryId,
      pullRequestId: input.pullRequestId,
      prNumber: input.prNumber,
      headSha: input.headSha,
      triggerSource: input.triggerSource,
      status: input.status,
      reviewMode: input.reviewMode || 'standard',
      reviewAction: input.reviewAction || 'COMMENT',
      parentReviewRunId: input.parentReviewRunId,
      scoreVersion: input.scoreVersion,
      startedAt: input.startedAt || nowIso()
    };

    this.reviewRuns.set(run.id, run);
    return clone(run);
  }

  async getReviewRunById(reviewRunId: string): Promise<ReviewRunRecord | undefined> {
    const run = this.reviewRuns.get(reviewRunId);
    return run ? clone(run) : undefined;
  }

  async updateReviewRun(reviewRunId: string, patch: UpdateReviewRunPatch): Promise<ReviewRunRecord | undefined> {
    const existing = this.reviewRuns.get(reviewRunId);
    if (!existing) {
      return undefined;
    }

    const next: ReviewRunRecord = {
      ...existing,
      ...patch
    };

    this.reviewRuns.set(reviewRunId, next);
    return clone(next);
  }

  async listReviewRunsByPullRequest(pullRequestId: string): Promise<ReviewRunRecord[]> {
    const runs = Array.from(this.reviewRuns.values())
      .filter(item => item.pullRequestId === pullRequestId)
      .sort((a, b) => compareIsoDesc(a.startedAt, b.startedAt));
    return clone(runs);
  }

  async listReviewRunsByRepository(repositoryId: string): Promise<ReviewRunRecord[]> {
    const runs = Array.from(this.reviewRuns.values())
      .filter(item => item.repositoryId === repositoryId)
      .sort((a, b) => compareIsoDesc(a.startedAt, b.startedAt));
    return clone(runs);
  }

  async addReviewFinding(
    input: Omit<ReviewFindingRecord, 'id' | 'createdAt'> & { createdAt?: string }
  ): Promise<ReviewFindingRecord> {
    const finding: ReviewFindingRecord = {
      id: id('rf'),
      reviewRunId: input.reviewRunId,
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      suggestion: input.suggestion,
      filePath: input.filePath,
      line: input.line,
      confidence: input.confidence,
      status: input.status || 'open',
      findingFingerprint: input.findingFingerprint,
      createdAt: input.createdAt || nowIso()
    };

    this.reviewFindings.set(finding.id, finding);
    return clone(finding);
  }

  async listReviewFindingsByRun(reviewRunId: string): Promise<ReviewFindingRecord[]> {
    const findings = Array.from(this.reviewFindings.values()).filter(item => item.reviewRunId === reviewRunId);
    return clone(findings);
  }

  async updateReviewFinding(
    findingId: string,
    patch: Partial<Pick<ReviewFindingRecord, 'status'>>
  ): Promise<ReviewFindingRecord | undefined> {
    const existing = this.reviewFindings.get(findingId);
    if (!existing) {
      return undefined;
    }

    const next: ReviewFindingRecord = { ...existing, ...patch };
    this.reviewFindings.set(findingId, next);
    return clone(next);
  }

  async getLatestCompletedReviewRun(pullRequestId: string): Promise<ReviewRunRecord | undefined> {
    const runs = Array.from(this.reviewRuns.values())
      .filter(item => item.pullRequestId === pullRequestId && item.status === 'completed')
      .sort((a, b) => compareIsoDesc(a.startedAt, b.startedAt));
    return runs.length > 0 ? clone(runs[0]) : undefined;
  }

  async createIndexingRun(input: CreateIndexingRunInput): Promise<IndexingJobRecord> {
    const run: IndexingJobRecord = {
      id: id('idx'),
      repositoryId: input.repositoryId,
      status: input.status,
      sourceRef: input.sourceRef,
      summary: input.summary,
      startedAt: input.startedAt || nowIso(),
      completedAt: input.completedAt,
      errorMessage: input.errorMessage
    };

    this.indexingRuns.set(run.id, run);
    return clone(run);
  }

  async updateIndexingRun(indexingRunId: string, patch: UpdateIndexingRunPatch): Promise<IndexingJobRecord | undefined> {
    const existing = this.indexingRuns.get(indexingRunId);
    if (!existing) {
      return undefined;
    }

    const next: IndexingJobRecord = {
      ...existing,
      ...patch
    };

    this.indexingRuns.set(indexingRunId, next);
    return clone(next);
  }

  async listIndexingRunsByRepository(repositoryId: string): Promise<IndexingJobRecord[]> {
    const runs = Array.from(this.indexingRuns.values())
      .filter(item => item.repositoryId === repositoryId)
      .sort((a, b) => compareIsoDesc(a.startedAt, b.startedAt));
    return clone(runs);
  }

  async getWebhookEventByDeliveryId(provider: string, deliveryId: string): Promise<GitHubWebhookEnvelope | undefined> {
    const key = `${provider}:${deliveryId}`;
    const event = this.webhookEvents.get(key);
    return event ? clone(event) : undefined;
  }

  async recordWebhookEvent(input: GitHubWebhookEnvelope): Promise<GitHubWebhookEnvelope> {
    const key = `github:${input.deliveryId}`;
    const event: GitHubWebhookEnvelope = {
      ...input,
      processingStatus: input.processingStatus || 'received',
      receivedAt: input.receivedAt || nowIso()
    };
    this.webhookEvents.set(key, event);
    return clone(event);
  }

  async updateWebhookEvent(
    provider: string,
    deliveryId: string,
    patch: Partial<Pick<GitHubWebhookEnvelope, 'processingStatus' | 'processedAt' | 'signatureValid'>>
  ): Promise<GitHubWebhookEnvelope | undefined> {
    const key = `${provider}:${deliveryId}`;
    const existing = this.webhookEvents.get(key);
    if (!existing) {
      return undefined;
    }

    const next: GitHubWebhookEnvelope = {
      ...existing,
      ...patch
    };

    this.webhookEvents.set(key, next);
    return clone(next);
  }

  async appendAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const log: AuditLogRecord = {
      id: id('audit'),
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      requestId: input.requestId,
      createdAt: input.createdAt || nowIso()
    };

    this.auditLogs.push(log);
    return clone(log);
  }

  async listAuditLogs(workspaceId: string, limit = 100): Promise<AuditLogRecord[]> {
    const logs = this.auditLogs
      .filter(item => item.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit));
    return clone(logs);
  }

  async upsertWorkspaceSecret(input: UpsertWorkspaceSecretInput): Promise<WorkspaceSecretRecord> {
    const existing = Array.from(this.workspaceSecrets.values()).find(
      item => item.workspaceId === input.workspaceId && item.kind === input.kind
    );
    const timestamp = nowIso();

    const secret: WorkspaceSecretRecord = {
      id: existing?.id || id('sec'),
      workspaceId: input.workspaceId,
      kind: input.kind,
      keyId: input.keyId,
      encryptedValue: input.encryptedValue,
      createdByUserId: input.createdByUserId,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    };

    this.workspaceSecrets.set(secret.id, secret);
    return clone(secret);
  }

  async getWorkspaceSecret(
    workspaceId: string,
    kind: WorkspaceSecretRecord['kind']
  ): Promise<WorkspaceSecretRecord | undefined> {
    const secret = Array.from(this.workspaceSecrets.values()).find(
      item => item.workspaceId === workspaceId && item.kind === kind
    );
    return secret ? clone(secret) : undefined;
  }

  async saveIndexBatch(batch: SemanticIndexBatch): Promise<{ filesCreated: number; chunksCreated: number }> {
    let filesCreated = 0;
    let chunksCreated = 0;

    for (const file of batch.files) {
      const key = `${file.repositoryId}:${file.sourceRef}:${file.path}`;
      const existing = Array.from(this.indexedFiles.values()).find(
        f => f.repositoryId === file.repositoryId && f.sourceRef === file.sourceRef && f.path === file.path
      );
      if (existing) {
        this.indexedFiles.delete(existing.id);
      }
      this.indexedFiles.set(file.id, clone(file));
      filesCreated++;
    }

    for (const chunk of batch.chunks) {
      this.semanticChunks.set(chunk.id, clone(chunk));
      chunksCreated++;
    }

    return { filesCreated, chunksCreated };
  }

  async listIndexedFiles(repositoryId: string, sourceRef?: string): Promise<IndexedFileRecord[]> {
    const files = Array.from(this.indexedFiles.values()).filter(f => {
      if (f.repositoryId !== repositoryId) return false;
      if (sourceRef && f.sourceRef !== sourceRef) return false;
      return true;
    });
    return clone(files);
  }

  async listSemanticChunks(repositoryId: string, sourceRef: string): Promise<SemanticChunkRecord[]> {
    const chunks = Array.from(this.semanticChunks.values()).filter(
      c => c.repositoryId === repositoryId && c.sourceRef === sourceRef
    );
    return clone(chunks.sort((a, b) => a.chunkOrdinal - b.chunkOrdinal));
  }

  async deleteIndexedData(repositoryId: string, sourceRef?: string): Promise<{ filesDeleted: number; chunksDeleted: number }> {
    let filesDeleted = 0;
    let chunksDeleted = 0;

    for (const [fid, file] of this.indexedFiles) {
      if (file.repositoryId === repositoryId && (!sourceRef || file.sourceRef === sourceRef)) {
        this.indexedFiles.delete(fid);
        filesDeleted++;
      }
    }

    for (const [cid, chunk] of this.semanticChunks) {
      if (chunk.repositoryId === repositoryId && (!sourceRef || chunk.sourceRef === sourceRef)) {
        this.semanticChunks.delete(cid);
        chunksDeleted++;
      }
    }

    return { filesDeleted, chunksDeleted };
  }

  async getIndexingStats(repositoryId: string): Promise<{ totalFiles: number; totalChunks: number; languages: Record<string, number>; lastIndexedAt?: string }> {
    const files = Array.from(this.indexedFiles.values()).filter(f => f.repositoryId === repositoryId);
    const chunks = Array.from(this.semanticChunks.values()).filter(c => c.repositoryId === repositoryId);

    const languages: Record<string, number> = {};
    for (const file of files) {
      languages[file.language] = (languages[file.language] || 0) + 1;
    }

    let lastIndexedAt: string | undefined;
    for (const file of files) {
      if (!lastIndexedAt || file.indexedAt > lastIndexedAt) {
        lastIndexedAt = file.indexedAt;
      }
    }

    return { totalFiles: files.length, totalChunks: chunks.length, languages, lastIndexedAt };
  }

  async getRepositoryUsage(repositoryId: string, period: string): Promise<RepositoryUsageRecord | undefined> {
    const key = `${repositoryId}:${period}`;
    const record = this.repositoryUsage.get(key);
    return record ? clone(record) : undefined;
  }

  async incrementRepositoryUsage(repositoryId: string, period: string): Promise<RepositoryUsageRecord> {
    const key = `${repositoryId}:${period}`;
    const existing = this.repositoryUsage.get(key);
    const record: RepositoryUsageRecord = {
      id: existing?.id || id('ru'),
      repositoryId,
      period,
      reviewCount: (existing?.reviewCount || 0) + 1,
      lastReviewAt: nowIso()
    };
    this.repositoryUsage.set(key, record);
    return clone(record);
  }

  async getWorkspaceForRepository(repositoryId: string): Promise<WorkspaceRecord | undefined> {
    const repo = this.repositories.get(repositoryId);
    if (!repo) return undefined;
    return this.getWorkspaceById(repo.workspaceId);
  }
}
