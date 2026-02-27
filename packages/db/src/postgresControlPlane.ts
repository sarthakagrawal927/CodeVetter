import {
  AuditLogRecord,
  GitHubInstallationRecord,
  GitHubWebhookEnvelope,
  IndexingJobRecord,
  PullRequestRecord,
  RepositoryConnection,
  RepositoryRuleOverride,
  ReviewFindingRecord,
  ReviewRunRecord,
  SessionRecord,
  UserRecord,
  WorkspaceInviteRecord,
  WorkspaceMemberRecord,
  WorkspaceRecord,
  WorkspaceRuleDefaults,
  WorkspaceSecretRecord
} from '@code-reviewer/shared-types';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import {
  AddWorkspaceMemberInput,
  ControlPlaneDatabase,
  CreateAuditLogInput,
  CreateIndexingRunInput,
  CreateReviewRunInput,
  CreateSessionInput,
  CreateWorkspaceInput,
  CreateWorkspaceInviteInput,
  InMemoryControlPlaneDatabase,
  UpdateIndexingRunPatch,
  UpdateReviewRunPatch,
  UpsertGithubUserInput,
  UpsertGitHubInstallationInput,
  UpsertPullRequestInput,
  UpsertRepositoryInput,
  UpsertRepositoryRuleOverrideInput,
  UpsertWorkspaceRulesInput,
  UpsertWorkspaceSecretInput
} from './controlPlane';

type Row = QueryResultRow;

export type CockroachControlPlaneDatabaseOptions = {
  connectionString: string;
  applicationName?: string;
  maxConnections?: number;
};

export type CreateControlPlaneDatabaseOptions = {
  cockroachDatabaseUrl?: string;
  useInMemory?: boolean;
  applicationName?: string;
  maxConnections?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function toIso(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return nowIso();
}

function toOptionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return toIso(value);
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return toNumber(value);
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true' || value === '1') {
      return true;
    }

    if (value === 'false' || value === '0') {
      return false;
    }
  }

  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function toSeverityThresholds(value: unknown): {
  low: boolean;
  medium: boolean;
  high: boolean;
  critical: boolean;
} {
  const object = toRecord(value);
  return {
    low: toBoolean(object.low, true),
    medium: toBoolean(object.medium, true),
    high: toBoolean(object.high, true),
    critical: toBoolean(object.critical, true)
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === '23505';
}

function mapUser(row: Row): UserRecord {
  return {
    id: String(row.id),
    githubUserId: String(row.github_user_id),
    githubLogin: String(row.github_login),
    displayName: toOptionalString(row.display_name),
    avatarUrl: toOptionalString(row.avatar_url),
    email: toOptionalString(row.email),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSession(row: Row): SessionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sessionTokenHash: String(row.session_token_hash),
    expiresAt: toIso(row.expires_at),
    revokedAt: toOptionalIso(row.revoked_at),
    ipAddress: toOptionalString(row.ip_address),
    userAgent: toOptionalString(row.user_agent),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkspace(row: Row): WorkspaceRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    kind: row.kind as WorkspaceRecord['kind'],
    githubAccountType: (row.github_account_type as WorkspaceRecord['githubAccountType']) || undefined,
    githubAccountId: toOptionalString(row.github_account_id),
    createdByUserId: String(row.created_by_user_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkspaceMember(row: Row): WorkspaceMemberRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    githubUserId: String(row.github_user_id || ''),
    githubLogin: String(row.github_login || ''),
    role: row.role as WorkspaceMemberRecord['role'],
    status: row.status as WorkspaceMemberRecord['status'],
    invitedByUserId: toOptionalString(row.invited_by_user_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkspaceInvite(row: Row): WorkspaceInviteRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    inviteTokenHash: String(row.invite_token_hash),
    inviteeGithubLogin: toOptionalString(row.invitee_github_login),
    inviteeEmail: toOptionalString(row.invitee_email),
    role: row.role as WorkspaceInviteRecord['role'],
    status: row.status as WorkspaceInviteRecord['status'],
    invitedByUserId: String(row.invited_by_user_id),
    acceptedByUserId: toOptionalString(row.accepted_by_user_id),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapInstallation(row: Row): GitHubInstallationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    installationId: String(row.installation_id),
    accountType: row.account_type as GitHubInstallationRecord['accountType'],
    accountId: String(row.account_id),
    accountLogin: toOptionalString(row.account_login),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapRepository(row: Row): RepositoryConnection {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    provider: row.provider as RepositoryConnection['provider'],
    owner: String(row.owner),
    name: String(row.name),
    fullName: String(row.full_name),
    githubRepoId: toOptionalString(row.github_repo_id),
    installationId: toOptionalString(row.installation_id),
    defaultBranch: toOptionalString(row.default_branch),
    isPrivate: toBoolean(row.is_private, false),
    isActive: toBoolean(row.is_active, true),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkspaceRuleDefaults(row: Row): WorkspaceRuleDefaults {
  return {
    workspaceId: String(row.workspace_id),
    schemaVersion: toNumber(row.schema_version),
    failOnFindings: toBoolean(row.fail_on_findings, false),
    failOnSeverity: row.fail_on_severity as WorkspaceRuleDefaults['failOnSeverity'],
    maxInlineFindings: toNumber(row.max_inline_findings),
    minInlineSeverity: row.min_inline_severity as WorkspaceRuleDefaults['minInlineSeverity'],
    reviewTone: row.review_tone as WorkspaceRuleDefaults['reviewTone'],
    blockedPatterns: toStringArray(row.blocked_patterns),
    requiredChecks: toStringArray(row.required_checks),
    severityThresholds: toSeverityThresholds(row.severity_thresholds),
    updatedByUserId: toOptionalString(row.updated_by_user_id),
    updatedAt: toIso(row.updated_at)
  };
}

function mapRepositoryRuleOverride(row: Row): RepositoryRuleOverride {
  return {
    repositoryId: String(row.repository_id),
    schemaVersion: toNumber(row.schema_version),
    failOnFindings: toBoolean(row.fail_on_findings, false),
    failOnSeverity: row.fail_on_severity as RepositoryRuleOverride['failOnSeverity'],
    maxInlineFindings: toNumber(row.max_inline_findings),
    minInlineSeverity: row.min_inline_severity as RepositoryRuleOverride['minInlineSeverity'],
    reviewTone: row.review_tone as RepositoryRuleOverride['reviewTone'],
    blockedPatterns: toStringArray(row.blocked_patterns),
    requiredChecks: toStringArray(row.required_checks),
    severityThresholds: toSeverityThresholds(row.severity_thresholds),
    updatedByUserId: toOptionalString(row.updated_by_user_id),
    updatedAt: toIso(row.updated_at)
  };
}

function mapPullRequest(row: Row): PullRequestRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    githubPrId: toOptionalString(row.github_pr_id),
    prNumber: toNumber(row.pr_number),
    title: toOptionalString(row.title),
    authorGithubLogin: toOptionalString(row.author_github_login),
    baseRef: toOptionalString(row.base_ref),
    headRef: toOptionalString(row.head_ref),
    headSha: toOptionalString(row.head_sha),
    state: row.state as PullRequestRecord['state'],
    mergedAt: toOptionalIso(row.merged_at),
    closedAt: toOptionalIso(row.closed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapReviewRun(row: Row): ReviewRunRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    pullRequestId: toOptionalString(row.pull_request_id),
    prNumber: toNumber(row.pr_number),
    headSha: String(row.head_sha || ''),
    triggerSource: row.trigger_source as ReviewRunRecord['triggerSource'],
    status: row.status as ReviewRunRecord['status'],
    scoreVersion: toOptionalString(row.score_version),
    scoreComposite: toOptionalNumber(row.score_composite),
    findingsCount: toOptionalNumber(row.findings_count),
    startedAt: toOptionalIso(row.started_at),
    completedAt: toOptionalIso(row.completed_at),
    errorMessage: toOptionalString(row.error_message)
  };
}

function mapReviewFinding(row: Row): ReviewFindingRecord {
  return {
    id: String(row.id),
    reviewRunId: String(row.review_run_id),
    severity: row.severity as ReviewFindingRecord['severity'],
    title: String(row.title),
    summary: String(row.summary),
    filePath: toOptionalString(row.file_path),
    line: toOptionalNumber(row.line),
    confidence: toOptionalNumber(row.confidence),
    createdAt: toIso(row.created_at)
  };
}

function mapIndexingRun(row: Row): IndexingJobRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    status: row.status as IndexingJobRecord['status'],
    sourceRef: toOptionalString(row.source_ref),
    summary: isPlainObject(row.summary) ? row.summary : undefined,
    startedAt: toOptionalIso(row.started_at),
    completedAt: toOptionalIso(row.completed_at),
    errorMessage: toOptionalString(row.error_message)
  };
}

function mapWebhookEvent(row: Row): GitHubWebhookEnvelope {
  return {
    id: toOptionalString(row.id),
    event: String(row.event),
    deliveryId: String(row.delivery_id),
    signature256: toOptionalString(row.signature_256),
    signatureValid: toBoolean(row.signature_valid, false),
    processingStatus: row.processing_status as GitHubWebhookEnvelope['processingStatus'],
    payload: row.payload,
    receivedAt: toIso(row.received_at),
    processedAt: toOptionalIso(row.processed_at)
  };
}

function mapAuditLog(row: Row): AuditLogRecord {
  return {
    id: String(row.id),
    workspaceId: toOptionalString(row.workspace_id),
    actorUserId: toOptionalString(row.actor_user_id),
    action: String(row.action),
    resourceType: String(row.resource_type),
    resourceId: toOptionalString(row.resource_id),
    metadata: toRecord(row.metadata),
    requestId: toOptionalString(row.request_id),
    createdAt: toIso(row.created_at)
  };
}

function mapWorkspaceSecret(row: Row): WorkspaceSecretRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: row.kind as WorkspaceSecretRecord['kind'],
    keyId: toOptionalString(row.key_id),
    encryptedValue: String(row.encrypted_value),
    createdByUserId: toOptionalString(row.created_by_user_id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export class CockroachControlPlaneDatabase implements ControlPlaneDatabase {
  private readonly pool: Pool;

  constructor(options: CockroachControlPlaneDatabaseOptions) {
    const config: PoolConfig = {
      connectionString: options.connectionString,
      max: options.maxConnections || 10
    };

    if (options.applicationName) {
      config.application_name = options.applicationName;
    }

    this.pool = new Pool(config);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, values);
    return result.rows;
  }

  private async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = []
  ): Promise<T | undefined> {
    const rows = await this.query<T>(text, values);
    return rows[0];
  }

  async upsertUserFromGithub(input: UpsertGithubUserInput): Promise<UserRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO users (
        id, github_user_id, github_login, display_name, avatar_url, email, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (github_user_id)
      DO UPDATE SET
        github_login = EXCLUDED.github_login,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        email = EXCLUDED.email,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        id('usr'),
        input.githubUserId,
        input.githubLogin,
        input.displayName || null,
        input.avatarUrl || null,
        input.email || null,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert user.');
    }

    return mapUser(row);
  }

  async getUserById(userId: string): Promise<UserRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
    return row ? mapUser(row) : undefined;
  }

  async getUserByGithubId(githubUserId: string): Promise<UserRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM users WHERE github_user_id = $1 LIMIT 1`, [githubUserId]);
    return row ? mapUser(row) : undefined;
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = await this.query<Row>(`SELECT * FROM users ORDER BY created_at ASC`);
    return rows.map(mapUser);
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO sessions (
        id, user_id, session_token_hash, expires_at, revoked_at, ip_address, user_agent, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        id('sess'),
        input.userId,
        input.sessionTokenHash,
        input.expiresAt,
        null,
        input.ipAddress || null,
        input.userAgent || null,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to create session.');
    }

    return mapSession(row);
  }

  async getSessionByTokenHash(sessionTokenHash: string): Promise<SessionRecord | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM sessions WHERE session_token_hash = $1 LIMIT 1`,
      [sessionTokenHash]
    );
    return row ? mapSession(row) : undefined;
  }

  async revokeSession(sessionId: string): Promise<SessionRecord | undefined> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `UPDATE sessions
       SET revoked_at = $2, updated_at = $2
       WHERE id = $1
       RETURNING *`,
      [sessionId, timestamp]
    );

    return row ? mapSession(row) : undefined;
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceRecord[]> {
    const rows = await this.query<Row>(
      `SELECT w.* FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = $1 AND m.status = 'active'
       ORDER BY w.created_at ASC`,
      [userId]
    );
    return rows.map(mapWorkspace);
  }

  async listAllWorkspaces(): Promise<WorkspaceRecord[]> {
    const rows = await this.query<Row>(`SELECT * FROM workspaces ORDER BY created_at ASC`);
    return rows.map(mapWorkspace);
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const timestamp = nowIso();

    let row: Row | undefined;
    try {
      row = await this.queryOne<Row>(
        `INSERT INTO workspaces (
          id, slug, name, kind, github_account_type, github_account_id, created_by_user_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *`,
        [
          id('ws'),
          input.slug,
          input.name,
          input.kind,
          input.githubAccountType || null,
          input.githubAccountId || null,
          input.createdByUserId,
          timestamp,
          timestamp
        ]
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error(`Workspace slug already exists: ${input.slug}`);
      }
      throw error;
    }

    if (!row) {
      throw new Error('Failed to create workspace.');
    }

    const workspace = mapWorkspace(row);

    await this.addWorkspaceMember({
      workspaceId: workspace.id,
      userId: input.createdByUserId,
      githubUserId: '',
      githubLogin: '',
      role: 'owner',
      status: 'active'
    });

    return workspace;
  }

  async getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM workspaces WHERE id = $1 LIMIT 1`, [workspaceId]);
    return row ? mapWorkspace(row) : undefined;
  }

  async getWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM workspaces WHERE slug = $1 LIMIT 1`, [slug]);
    return row ? mapWorkspace(row) : undefined;
  }

  async addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMemberRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_members (
        id, workspace_id, user_id, github_user_id, github_login, role, status, invited_by_user_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET
        github_user_id = EXCLUDED.github_user_id,
        github_login = EXCLUDED.github_login,
        role = EXCLUDED.role,
        status = EXCLUDED.status,
        invited_by_user_id = EXCLUDED.invited_by_user_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        id('wm'),
        input.workspaceId,
        input.userId,
        input.githubUserId,
        input.githubLogin,
        input.role,
        input.status,
        input.invitedByUserId || null,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert workspace member.');
    }

    return mapWorkspaceMember(row);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM workspace_members WHERE workspace_id = $1 ORDER BY created_at ASC`,
      [workspaceId]
    );
    return rows.map(mapWorkspaceMember);
  }

  async getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMemberRecord | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [workspaceId, userId]
    );
    return row ? mapWorkspaceMember(row) : undefined;
  }

  async updateWorkspaceMember(
    workspaceId: string,
    memberId: string,
    patch: Partial<Pick<WorkspaceMemberRecord, 'role' | 'status'>>
  ): Promise<WorkspaceMemberRecord | undefined> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `UPDATE workspace_members
       SET role = COALESCE($3, role),
           status = COALESCE($4, status),
           updated_at = $5
       WHERE workspace_id = $1 AND id = $2
       RETURNING *`,
      [workspaceId, memberId, patch.role || null, patch.status || null, timestamp]
    );

    return row ? mapWorkspaceMember(row) : undefined;
  }

  async createWorkspaceInvite(input: CreateWorkspaceInviteInput): Promise<WorkspaceInviteRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_invites (
        id, workspace_id, invite_token_hash, invitee_github_login, invitee_email, role, status,
        invited_by_user_id, accepted_by_user_id, expires_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        id('inv'),
        input.workspaceId,
        input.inviteTokenHash,
        input.inviteeGithubLogin || null,
        input.inviteeEmail || null,
        input.role,
        input.invitedByUserId,
        null,
        input.expiresAt,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to create workspace invite.');
    }

    return mapWorkspaceInvite(row);
  }

  async getWorkspaceInviteByTokenHash(tokenHash: string): Promise<WorkspaceInviteRecord | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM workspace_invites WHERE invite_token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    return row ? mapWorkspaceInvite(row) : undefined;
  }

  async consumeWorkspaceInvite(inviteId: string, acceptedByUserId: string): Promise<WorkspaceInviteRecord | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE workspace_invites
       SET status = 'accepted',
           accepted_by_user_id = $2,
           updated_at = $3
       WHERE id = $1
       RETURNING *`,
      [inviteId, acceptedByUserId, nowIso()]
    );

    return row ? mapWorkspaceInvite(row) : undefined;
  }

  async listGitHubInstallations(workspaceId: string): Promise<GitHubInstallationRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM github_installations WHERE workspace_id = $1 ORDER BY created_at ASC`,
      [workspaceId]
    );

    return rows.map(mapInstallation);
  }

  async upsertGitHubInstallation(input: UpsertGitHubInstallationInput): Promise<GitHubInstallationRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO github_installations (
        id, workspace_id, installation_id, account_type, account_id, account_login, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (workspace_id, installation_id)
      DO UPDATE SET
        account_type = EXCLUDED.account_type,
        account_id = EXCLUDED.account_id,
        account_login = EXCLUDED.account_login,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        id('ghi'),
        input.workspaceId,
        input.installationId,
        input.accountType,
        input.accountId,
        input.accountLogin || null,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert GitHub installation.');
    }

    return mapInstallation(row);
  }

  async listRepositories(workspaceId: string): Promise<RepositoryConnection[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM repositories WHERE workspace_id = $1 ORDER BY full_name ASC`,
      [workspaceId]
    );

    return rows.map(mapRepository);
  }

  async listAllRepositories(): Promise<RepositoryConnection[]> {
    const rows = await this.query<Row>(`SELECT * FROM repositories ORDER BY full_name ASC`);
    return rows.map(mapRepository);
  }

  async upsertRepository(input: UpsertRepositoryInput): Promise<RepositoryConnection> {
    const timestamp = nowIso();

    const row = await this.queryOne<Row>(
      `INSERT INTO repositories (
        id, workspace_id, provider, github_repo_id, owner, name, full_name,
        installation_id, default_branch, is_private, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (workspace_id, full_name)
      DO UPDATE SET
        provider = EXCLUDED.provider,
        github_repo_id = EXCLUDED.github_repo_id,
        owner = EXCLUDED.owner,
        name = EXCLUDED.name,
        installation_id = EXCLUDED.installation_id,
        default_branch = EXCLUDED.default_branch,
        is_private = EXCLUDED.is_private,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        id('repo'),
        input.workspaceId,
        input.provider,
        input.githubRepoId || null,
        input.owner,
        input.name,
        input.fullName,
        input.installationId || null,
        input.defaultBranch || null,
        input.isPrivate || false,
        input.isActive,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert repository.');
    }

    return mapRepository(row);
  }

  async getRepositoryById(repositoryId: string): Promise<RepositoryConnection | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM repositories WHERE id = $1 LIMIT 1`, [repositoryId]);
    return row ? mapRepository(row) : undefined;
  }

  async getRepositoryByFullName(workspaceId: string, fullName: string): Promise<RepositoryConnection | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM repositories WHERE workspace_id = $1 AND full_name = $2 LIMIT 1`,
      [workspaceId, fullName]
    );

    return row ? mapRepository(row) : undefined;
  }

  async getWorkspaceRuleDefaults(workspaceId: string): Promise<WorkspaceRuleDefaults | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM workspace_rule_defaults WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    return row ? mapWorkspaceRuleDefaults(row) : undefined;
  }

  async upsertWorkspaceRuleDefaults(input: UpsertWorkspaceRulesInput): Promise<WorkspaceRuleDefaults> {
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_rule_defaults (
        workspace_id, schema_version, fail_on_findings, fail_on_severity, max_inline_findings,
        min_inline_severity, review_tone, blocked_patterns, required_checks, severity_thresholds,
        updated_by_user_id, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        fail_on_findings = EXCLUDED.fail_on_findings,
        fail_on_severity = EXCLUDED.fail_on_severity,
        max_inline_findings = EXCLUDED.max_inline_findings,
        min_inline_severity = EXCLUDED.min_inline_severity,
        review_tone = EXCLUDED.review_tone,
        blocked_patterns = EXCLUDED.blocked_patterns,
        required_checks = EXCLUDED.required_checks,
        severity_thresholds = EXCLUDED.severity_thresholds,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        input.workspaceId,
        input.schemaVersion,
        input.failOnFindings,
        input.failOnSeverity,
        input.maxInlineFindings,
        input.minInlineSeverity,
        input.reviewTone,
        JSON.stringify(input.blockedPatterns || []),
        JSON.stringify(input.requiredChecks || []),
        JSON.stringify(input.severityThresholds),
        input.updatedByUserId || null,
        input.updatedAt || nowIso()
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert workspace rule defaults.');
    }

    return mapWorkspaceRuleDefaults(row);
  }

  async getRepositoryRuleOverride(repositoryId: string): Promise<RepositoryRuleOverride | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM repository_rule_overrides WHERE repository_id = $1 LIMIT 1`,
      [repositoryId]
    );

    return row ? mapRepositoryRuleOverride(row) : undefined;
  }

  async upsertRepositoryRuleOverride(input: UpsertRepositoryRuleOverrideInput): Promise<RepositoryRuleOverride> {
    const row = await this.queryOne<Row>(
      `INSERT INTO repository_rule_overrides (
        repository_id, schema_version, fail_on_findings, fail_on_severity, max_inline_findings,
        min_inline_severity, review_tone, blocked_patterns, required_checks, severity_thresholds,
        updated_by_user_id, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
      ON CONFLICT (repository_id)
      DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        fail_on_findings = EXCLUDED.fail_on_findings,
        fail_on_severity = EXCLUDED.fail_on_severity,
        max_inline_findings = EXCLUDED.max_inline_findings,
        min_inline_severity = EXCLUDED.min_inline_severity,
        review_tone = EXCLUDED.review_tone,
        blocked_patterns = EXCLUDED.blocked_patterns,
        required_checks = EXCLUDED.required_checks,
        severity_thresholds = EXCLUDED.severity_thresholds,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        input.repositoryId,
        input.schemaVersion,
        input.failOnFindings,
        input.failOnSeverity,
        input.maxInlineFindings,
        input.minInlineSeverity,
        input.reviewTone,
        JSON.stringify(input.blockedPatterns || []),
        JSON.stringify(input.requiredChecks || []),
        JSON.stringify(input.severityThresholds),
        input.updatedByUserId || null,
        input.updatedAt || nowIso()
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert repository rule override.');
    }

    return mapRepositoryRuleOverride(row);
  }

  async upsertPullRequest(input: UpsertPullRequestInput): Promise<PullRequestRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO pull_requests (
        id, repository_id, github_pr_id, pr_number, title, author_github_login,
        base_ref, head_ref, head_sha, state, merged_at, closed_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (repository_id, pr_number)
      DO UPDATE SET
        github_pr_id = EXCLUDED.github_pr_id,
        title = EXCLUDED.title,
        author_github_login = EXCLUDED.author_github_login,
        base_ref = EXCLUDED.base_ref,
        head_ref = EXCLUDED.head_ref,
        head_sha = EXCLUDED.head_sha,
        state = EXCLUDED.state,
        merged_at = EXCLUDED.merged_at,
        closed_at = EXCLUDED.closed_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        id('pr'),
        input.repositoryId,
        input.githubPrId || null,
        input.prNumber,
        input.title || null,
        input.authorGithubLogin || null,
        input.baseRef || null,
        input.headRef || null,
        input.headSha || null,
        input.state,
        input.mergedAt || null,
        input.closedAt || null,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert pull request.');
    }

    return mapPullRequest(row);
  }

  async getPullRequestById(pullRequestId: string): Promise<PullRequestRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM pull_requests WHERE id = $1 LIMIT 1`, [pullRequestId]);
    return row ? mapPullRequest(row) : undefined;
  }

  async listPullRequestsByRepository(repositoryId: string): Promise<PullRequestRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM pull_requests WHERE repository_id = $1 ORDER BY pr_number DESC`,
      [repositoryId]
    );
    return rows.map(mapPullRequest);
  }

  async createReviewRun(input: CreateReviewRunInput): Promise<ReviewRunRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO review_runs (
        id, repository_id, pull_request_id, pr_number, trigger_source, status,
        head_sha, score_version, score_composite, findings_count, started_at, completed_at, error_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        id('rr'),
        input.repositoryId,
        input.pullRequestId || null,
        input.prNumber,
        input.triggerSource || 'manual',
        input.status,
        input.headSha,
        input.scoreVersion || 'v1.0.0',
        null,
        null,
        input.startedAt || nowIso(),
        null,
        null
      ]
    );

    if (!row) {
      throw new Error('Failed to create review run.');
    }

    return mapReviewRun(row);
  }

  async getReviewRunById(reviewRunId: string): Promise<ReviewRunRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM review_runs WHERE id = $1 LIMIT 1`, [reviewRunId]);
    return row ? mapReviewRun(row) : undefined;
  }

  async updateReviewRun(reviewRunId: string, patch: UpdateReviewRunPatch): Promise<ReviewRunRecord | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE review_runs
       SET status = COALESCE($2, status),
           score_composite = COALESCE($3, score_composite),
           findings_count = COALESCE($4, findings_count),
           completed_at = COALESCE($5, completed_at),
           error_message = COALESCE($6, error_message),
           score_version = COALESCE($7, score_version)
       WHERE id = $1
       RETURNING *`,
      [
        reviewRunId,
        patch.status || null,
        patch.scoreComposite ?? null,
        patch.findingsCount ?? null,
        patch.completedAt || null,
        patch.errorMessage || null,
        patch.scoreVersion || null
      ]
    );

    return row ? mapReviewRun(row) : undefined;
  }

  async listReviewRunsByPullRequest(pullRequestId: string): Promise<ReviewRunRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM review_runs WHERE pull_request_id = $1 ORDER BY started_at DESC NULLS LAST`,
      [pullRequestId]
    );

    return rows.map(mapReviewRun);
  }

  async listReviewRunsByRepository(repositoryId: string): Promise<ReviewRunRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM review_runs WHERE repository_id = $1 ORDER BY started_at DESC NULLS LAST`,
      [repositoryId]
    );

    return rows.map(mapReviewRun);
  }

  async addReviewFinding(
    input: Omit<ReviewFindingRecord, 'id' | 'createdAt'> & { createdAt?: string }
  ): Promise<ReviewFindingRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO review_findings (
        id, review_run_id, severity, title, summary, file_path, line, confidence, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        id('rf'),
        input.reviewRunId,
        input.severity,
        input.title,
        input.summary,
        input.filePath || null,
        input.line ?? null,
        input.confidence ?? null,
        input.createdAt || nowIso()
      ]
    );

    if (!row) {
      throw new Error('Failed to create review finding.');
    }

    return mapReviewFinding(row);
  }

  async listReviewFindingsByRun(reviewRunId: string): Promise<ReviewFindingRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM review_findings WHERE review_run_id = $1 ORDER BY created_at ASC`,
      [reviewRunId]
    );

    return rows.map(mapReviewFinding);
  }

  async createIndexingRun(input: CreateIndexingRunInput): Promise<IndexingJobRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO indexing_runs (
        id, repository_id, source_ref, status, summary, started_at, completed_at, error_message
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
      RETURNING *`,
      [
        id('idx'),
        input.repositoryId,
        input.sourceRef || null,
        input.status,
        input.summary ? JSON.stringify(input.summary) : null,
        input.startedAt || nowIso(),
        input.completedAt || null,
        input.errorMessage || null
      ]
    );

    if (!row) {
      throw new Error('Failed to create indexing run.');
    }

    return mapIndexingRun(row);
  }

  async updateIndexingRun(indexingRunId: string, patch: UpdateIndexingRunPatch): Promise<IndexingJobRecord | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE indexing_runs
       SET status = COALESCE($2, status),
           summary = COALESCE($3::jsonb, summary),
           completed_at = COALESCE($4, completed_at),
           error_message = COALESCE($5, error_message)
       WHERE id = $1
       RETURNING *`,
      [
        indexingRunId,
        patch.status || null,
        patch.summary ? JSON.stringify(patch.summary) : null,
        patch.completedAt || null,
        patch.errorMessage || null
      ]
    );

    return row ? mapIndexingRun(row) : undefined;
  }

  async listIndexingRunsByRepository(repositoryId: string): Promise<IndexingJobRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM indexing_runs WHERE repository_id = $1 ORDER BY started_at DESC NULLS LAST`,
      [repositoryId]
    );

    return rows.map(mapIndexingRun);
  }

  async getWebhookEventByDeliveryId(provider: string, deliveryId: string): Promise<GitHubWebhookEnvelope | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM webhook_events WHERE provider = $1 AND delivery_id = $2 LIMIT 1`,
      [provider, deliveryId]
    );

    return row ? mapWebhookEvent(row) : undefined;
  }

  async recordWebhookEvent(input: GitHubWebhookEnvelope): Promise<GitHubWebhookEnvelope> {
    const row = await this.queryOne<Row>(
      `INSERT INTO webhook_events (
        id, provider, event, delivery_id, signature_256, signature_valid, processing_status, payload, received_at, processed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
      ON CONFLICT (provider, delivery_id)
      DO UPDATE SET
        event = EXCLUDED.event,
        signature_256 = EXCLUDED.signature_256,
        signature_valid = EXCLUDED.signature_valid,
        processing_status = EXCLUDED.processing_status,
        payload = EXCLUDED.payload,
        received_at = EXCLUDED.received_at,
        processed_at = EXCLUDED.processed_at
      RETURNING *`,
      [
        input.id || id('wh'),
        'github',
        input.event,
        input.deliveryId,
        input.signature256 || null,
        Boolean(input.signatureValid),
        input.processingStatus || 'received',
        JSON.stringify(input.payload ?? {}),
        input.receivedAt || nowIso(),
        input.processedAt || null
      ]
    );

    if (!row) {
      throw new Error('Failed to record webhook event.');
    }

    return mapWebhookEvent(row);
  }

  async updateWebhookEvent(
    provider: string,
    deliveryId: string,
    patch: Partial<Pick<GitHubWebhookEnvelope, 'processingStatus' | 'processedAt' | 'signatureValid'>>
  ): Promise<GitHubWebhookEnvelope | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE webhook_events
       SET processing_status = COALESCE($3, processing_status),
           processed_at = COALESCE($4, processed_at),
           signature_valid = COALESCE($5, signature_valid)
       WHERE provider = $1 AND delivery_id = $2
       RETURNING *`,
      [provider, deliveryId, patch.processingStatus || null, patch.processedAt || null, patch.signatureValid ?? null]
    );

    return row ? mapWebhookEvent(row) : undefined;
  }

  async appendAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO audit_logs (
        id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata, request_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      RETURNING *`,
      [
        id('audit'),
        input.workspaceId || null,
        input.actorUserId || null,
        input.action,
        input.resourceType,
        input.resourceId || null,
        JSON.stringify(input.metadata || {}),
        input.requestId || null,
        input.createdAt || nowIso()
      ]
    );

    if (!row) {
      throw new Error('Failed to append audit log.');
    }

    return mapAuditLog(row);
  }

  async listAuditLogs(workspaceId: string, limit = 100): Promise<AuditLogRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM audit_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [workspaceId, Math.max(1, limit)]
    );

    return rows.map(mapAuditLog);
  }

  async upsertWorkspaceSecret(input: UpsertWorkspaceSecretInput): Promise<WorkspaceSecretRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_secrets (
        id, workspace_id, kind, key_id, encrypted_value, created_by_user_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (workspace_id, kind)
      DO UPDATE SET
        key_id = EXCLUDED.key_id,
        encrypted_value = EXCLUDED.encrypted_value,
        created_by_user_id = EXCLUDED.created_by_user_id,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        id('sec'),
        input.workspaceId,
        input.kind,
        input.keyId || null,
        input.encryptedValue,
        input.createdByUserId || null,
        timestamp,
        timestamp
      ]
    );

    if (!row) {
      throw new Error('Failed to upsert workspace secret.');
    }

    return mapWorkspaceSecret(row);
  }

  async getWorkspaceSecret(
    workspaceId: string,
    kind: WorkspaceSecretRecord['kind']
  ): Promise<WorkspaceSecretRecord | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM workspace_secrets WHERE workspace_id = $1 AND kind = $2 LIMIT 1`,
      [workspaceId, kind]
    );

    return row ? mapWorkspaceSecret(row) : undefined;
  }
}

export function createControlPlaneDatabase(options: CreateControlPlaneDatabaseOptions): ControlPlaneDatabase {
  const connectionString = options.cockroachDatabaseUrl?.trim();

  if (options.useInMemory || !connectionString) {
    return new InMemoryControlPlaneDatabase();
  }

  return new CockroachControlPlaneDatabase({
    connectionString,
    applicationName: options.applicationName,
    maxConnections: options.maxConnections
  });
}
