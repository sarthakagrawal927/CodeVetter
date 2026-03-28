import {
  AuditLogRecord,
  GitHubInstallationRecord,
  GitHubWebhookEnvelope,
  IndexedFileRecord,
  IndexingJobRecord,
  PullRequestRecord,
  RepositoryConnection,
  RepositoryRuleOverride,
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

type Row = Record<string, unknown>;

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
  if (typeof value === 'number') {
    return value !== 0;
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

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
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
  const message = (error as { message?: string }).message || '';
  return message.includes('UNIQUE constraint failed');
}

// ── Row mappers ────────────────────────────────────────────────────────────────

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
    blockedPatterns: toStringArray(parseJson(row.blocked_patterns)),
    requiredChecks: toStringArray(parseJson(row.required_checks)),
    severityThresholds: toSeverityThresholds(parseJson(row.severity_thresholds)),
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
    blockedPatterns: toStringArray(parseJson(row.blocked_patterns)),
    requiredChecks: toStringArray(parseJson(row.required_checks)),
    severityThresholds: toSeverityThresholds(parseJson(row.severity_thresholds)),
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
    isAgentAuthored: toBoolean(row.is_agent_authored),
    agentName: toOptionalString(row.agent_name),
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
    reviewMode: (row.review_mode as ReviewRunRecord['reviewMode']) || 'standard',
    reviewAction: (row.review_action as ReviewRunRecord['reviewAction']) || 'COMMENT',
    parentReviewRunId: toOptionalString(row.parent_review_run_id),
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
    suggestion: toOptionalString(row.suggestion),
    filePath: toOptionalString(row.file_path),
    line: toOptionalNumber(row.line),
    confidence: toOptionalNumber(row.confidence),
    status: (row.status as ReviewFindingRecord['status']) || 'open',
    findingFingerprint: toOptionalString(row.finding_fingerprint),
    createdAt: toIso(row.created_at)
  };
}

function mapIndexingRun(row: Row): IndexingJobRecord {
  const summary = parseJson(row.summary);
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    status: row.status as IndexingJobRecord['status'],
    sourceRef: toOptionalString(row.source_ref),
    summary: isPlainObject(summary) ? summary : undefined,
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
    payload: parseJson(row.payload),
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
    metadata: toRecord(parseJson(row.metadata)),
    requestId: toOptionalString(row.request_id),
    createdAt: toIso(row.created_at)
  };
}

function mapIndexedFile(row: Row): IndexedFileRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    sourceRef: String(row.source_ref),
    path: String(row.path),
    blobSha: String(row.blob_sha),
    contentSha256: String(row.content_sha256),
    language: row.language as IndexedFileRecord['language'],
    sizeBytes: toNumber(row.size_bytes),
    indexedAt: toIso(row.indexed_at),
    chunkStrategy: row.chunk_strategy as IndexedFileRecord['chunkStrategy']
  };
}

function mapSemanticChunk(row: Row): SemanticChunkRecord {
  return {
    id: String(row.id),
    repositoryId: String(row.repository_id),
    sourceRef: String(row.source_ref),
    filePath: String(row.file_path),
    fileContentSha256: String(row.file_content_sha256),
    language: row.language as SemanticChunkRecord['language'],
    symbolKind: row.symbol_kind as SemanticChunkRecord['symbolKind'],
    symbolName: toOptionalString(row.symbol_name),
    chunkOrdinal: toNumber(row.chunk_ordinal),
    startLine: toNumber(row.start_line),
    endLine: toNumber(row.end_line),
    content: String(row.content),
    contentSha256: String(row.content_sha256),
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

// ── D1 Control Plane Database ──────────────────────────────────────────────────

export class D1ControlPlaneDatabase implements ControlPlaneDatabase {
  constructor(private readonly db: D1Database) {}

  private async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const { results } = await bound.all<T>();
    return results;
  }

  private async queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const stmt = this.db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const row = await bound.first<T>();
    return row ?? undefined;
  }

  private async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const stmt = this.db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.run();
    return { changes: result.meta.changes };
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async upsertUserFromGithub(input: UpsertGithubUserInput): Promise<UserRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO users (
        id, github_user_id, github_login, display_name, avatar_url, email, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
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
    const row = await this.queryOne<Row>(`SELECT * FROM users WHERE id = ?1 LIMIT 1`, [userId]);
    return row ? mapUser(row) : undefined;
  }

  async getUserByGithubId(githubUserId: string): Promise<UserRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM users WHERE github_user_id = ?1 LIMIT 1`, [githubUserId]);
    return row ? mapUser(row) : undefined;
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = await this.query<Row>(`SELECT * FROM users ORDER BY created_at ASC`);
    return rows.map(mapUser);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO sessions (
        id, user_id, session_token_hash, expires_at, revoked_at, ip_address, user_agent, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
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
      `SELECT * FROM sessions WHERE session_token_hash = ?1 LIMIT 1`,
      [sessionTokenHash]
    );
    return row ? mapSession(row) : undefined;
  }

  async revokeSession(sessionId: string): Promise<SessionRecord | undefined> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `UPDATE sessions
       SET revoked_at = ?2, updated_at = ?2
       WHERE id = ?1
       RETURNING *`,
      [sessionId, timestamp]
    );
    return row ? mapSession(row) : undefined;
  }

  // ── Workspaces ─────────────────────────────────────────────────────────────

  async listWorkspacesForUser(userId: string): Promise<WorkspaceRecord[]> {
    const rows = await this.query<Row>(
      `SELECT w.* FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ?1 AND m.status = 'active'
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
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
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
    const row = await this.queryOne<Row>(`SELECT * FROM workspaces WHERE id = ?1 LIMIT 1`, [workspaceId]);
    return row ? mapWorkspace(row) : undefined;
  }

  async getWorkspaceBySlug(slug: string): Promise<WorkspaceRecord | undefined> {
    const row = await this.queryOne<Row>(`SELECT * FROM workspaces WHERE slug = ?1 LIMIT 1`, [slug]);
    return row ? mapWorkspace(row) : undefined;
  }

  // ── Workspace Members ──────────────────────────────────────────────────────

  async addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceMemberRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_members (
        id, workspace_id, user_id, github_user_id, github_login, role, status, invited_by_user_id, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
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
      `SELECT * FROM workspace_members WHERE workspace_id = ?1 ORDER BY created_at ASC`,
      [workspaceId]
    );
    return rows.map(mapWorkspaceMember);
  }

  async getWorkspaceMember(workspaceId: string, userId: string): Promise<WorkspaceMemberRecord | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1`,
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
       SET role = COALESCE(?3, role),
           status = COALESCE(?4, status),
           updated_at = ?5
       WHERE workspace_id = ?1 AND id = ?2
       RETURNING *`,
      [workspaceId, memberId, patch.role || null, patch.status || null, timestamp]
    );
    return row ? mapWorkspaceMember(row) : undefined;
  }

  // ── Workspace Invites ──────────────────────────────────────────────────────

  async createWorkspaceInvite(input: CreateWorkspaceInviteInput): Promise<WorkspaceInviteRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_invites (
        id, workspace_id, invite_token_hash, invitee_github_login, invitee_email, role, status,
        invited_by_user_id, accepted_by_user_id, expires_at, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9,?10,?11)
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
      `SELECT * FROM workspace_invites WHERE invite_token_hash = ?1 LIMIT 1`,
      [tokenHash]
    );
    return row ? mapWorkspaceInvite(row) : undefined;
  }

  async consumeWorkspaceInvite(inviteId: string, acceptedByUserId: string): Promise<WorkspaceInviteRecord | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE workspace_invites
       SET status = 'accepted',
           accepted_by_user_id = ?2,
           updated_at = ?3
       WHERE id = ?1
       RETURNING *`,
      [inviteId, acceptedByUserId, nowIso()]
    );
    return row ? mapWorkspaceInvite(row) : undefined;
  }

  // ── GitHub Installations ───────────────────────────────────────────────────

  async listGitHubInstallations(workspaceId: string): Promise<GitHubInstallationRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM github_installations WHERE workspace_id = ?1 ORDER BY created_at ASC`,
      [workspaceId]
    );
    return rows.map(mapInstallation);
  }

  async upsertGitHubInstallation(input: UpsertGitHubInstallationInput): Promise<GitHubInstallationRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO github_installations (
        id, workspace_id, installation_id, account_type, account_id, account_login, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
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

  // ── Repositories ───────────────────────────────────────────────────────────

  async listRepositories(workspaceId: string): Promise<RepositoryConnection[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM repositories WHERE workspace_id = ?1 ORDER BY full_name ASC`,
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
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
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
        input.isPrivate ? 1 : 0,
        input.isActive ? 1 : 0,
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
    const row = await this.queryOne<Row>(`SELECT * FROM repositories WHERE id = ?1 LIMIT 1`, [repositoryId]);
    return row ? mapRepository(row) : undefined;
  }

  async getRepositoryByFullName(workspaceId: string, fullName: string): Promise<RepositoryConnection | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM repositories WHERE workspace_id = ?1 AND full_name = ?2 LIMIT 1`,
      [workspaceId, fullName]
    );
    return row ? mapRepository(row) : undefined;
  }

  // ── Workspace Rules ────────────────────────────────────────────────────────

  async getWorkspaceRuleDefaults(workspaceId: string): Promise<WorkspaceRuleDefaults | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM workspace_rule_defaults WHERE workspace_id = ?1 LIMIT 1`,
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
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
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
        input.failOnFindings ? 1 : 0,
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
      `SELECT * FROM repository_rule_overrides WHERE repository_id = ?1 LIMIT 1`,
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
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
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
        input.failOnFindings ? 1 : 0,
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

  // ── Pull Requests ──────────────────────────────────────────────────────────

  async upsertPullRequest(input: UpsertPullRequestInput): Promise<PullRequestRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO pull_requests (
        id, repository_id, github_pr_id, pr_number, title, author_github_login,
        base_ref, head_ref, head_sha, state, is_agent_authored, agent_name,
        merged_at, closed_at, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
      ON CONFLICT (repository_id, pr_number)
      DO UPDATE SET
        github_pr_id = EXCLUDED.github_pr_id,
        title = EXCLUDED.title,
        author_github_login = EXCLUDED.author_github_login,
        base_ref = EXCLUDED.base_ref,
        head_ref = EXCLUDED.head_ref,
        head_sha = EXCLUDED.head_sha,
        state = EXCLUDED.state,
        is_agent_authored = CASE WHEN EXCLUDED.is_agent_authored THEN 1 ELSE pull_requests.is_agent_authored END,
        agent_name = COALESCE(EXCLUDED.agent_name, pull_requests.agent_name),
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
        (input.isAgentAuthored ?? false) ? 1 : 0,
        input.agentName || null,
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
    const row = await this.queryOne<Row>(`SELECT * FROM pull_requests WHERE id = ?1 LIMIT 1`, [pullRequestId]);
    return row ? mapPullRequest(row) : undefined;
  }

  async listPullRequestsByRepository(repositoryId: string): Promise<PullRequestRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM pull_requests WHERE repository_id = ?1 ORDER BY pr_number DESC`,
      [repositoryId]
    );
    return rows.map(mapPullRequest);
  }

  // ── Review Runs ────────────────────────────────────────────────────────────

  async createReviewRun(input: CreateReviewRunInput): Promise<ReviewRunRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO review_runs (
        id, repository_id, pull_request_id, pr_number, trigger_source, status,
        head_sha, score_version, review_mode, review_action, parent_review_run_id,
        score_composite, findings_count, started_at, completed_at, error_message
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
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
        input.reviewMode || 'standard',
        input.reviewAction || 'COMMENT',
        input.parentReviewRunId || null,
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
    const row = await this.queryOne<Row>(`SELECT * FROM review_runs WHERE id = ?1 LIMIT 1`, [reviewRunId]);
    return row ? mapReviewRun(row) : undefined;
  }

  async updateReviewRun(reviewRunId: string, patch: UpdateReviewRunPatch): Promise<ReviewRunRecord | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE review_runs
       SET status = COALESCE(?2, status),
           score_composite = COALESCE(?3, score_composite),
           findings_count = COALESCE(?4, findings_count),
           completed_at = COALESCE(?5, completed_at),
           error_message = COALESCE(?6, error_message),
           score_version = COALESCE(?7, score_version),
           review_action = COALESCE(?8, review_action)
       WHERE id = ?1
       RETURNING *`,
      [
        reviewRunId,
        patch.status || null,
        patch.scoreComposite ?? null,
        patch.findingsCount ?? null,
        patch.completedAt || null,
        patch.errorMessage || null,
        patch.scoreVersion || null,
        patch.reviewAction || null
      ]
    );
    return row ? mapReviewRun(row) : undefined;
  }

  async listReviewRunsByPullRequest(pullRequestId: string): Promise<ReviewRunRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM review_runs WHERE pull_request_id = ?1
       ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END, started_at DESC`,
      [pullRequestId]
    );
    return rows.map(mapReviewRun);
  }

  async listReviewRunsByRepository(repositoryId: string): Promise<ReviewRunRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM review_runs WHERE repository_id = ?1
       ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END, started_at DESC`,
      [repositoryId]
    );
    return rows.map(mapReviewRun);
  }

  // ── Review Findings ────────────────────────────────────────────────────────

  async addReviewFinding(
    input: Omit<ReviewFindingRecord, 'id' | 'createdAt'> & { createdAt?: string }
  ): Promise<ReviewFindingRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO review_findings (
        id, review_run_id, severity, title, summary, suggestion, file_path, line, confidence,
        status, finding_fingerprint, created_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
      RETURNING *`,
      [
        id('rf'),
        input.reviewRunId,
        input.severity,
        input.title,
        input.summary,
        input.suggestion || null,
        input.filePath || null,
        input.line ?? null,
        input.confidence ?? null,
        input.status || 'open',
        input.findingFingerprint || null,
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
      `SELECT * FROM review_findings WHERE review_run_id = ?1 ORDER BY created_at ASC`,
      [reviewRunId]
    );
    return rows.map(mapReviewFinding);
  }

  async updateReviewFinding(
    findingId: string,
    patch: Partial<Pick<ReviewFindingRecord, 'status'>>
  ): Promise<ReviewFindingRecord | undefined> {
    const row = await this.queryOne<Row>(
      `UPDATE review_findings SET status = COALESCE(?2, status) WHERE id = ?1 RETURNING *`,
      [findingId, patch.status || null]
    );
    return row ? mapReviewFinding(row) : undefined;
  }

  async getLatestCompletedReviewRun(pullRequestId: string): Promise<ReviewRunRecord | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM review_runs WHERE pull_request_id = ?1 AND status = 'completed'
       ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END, started_at DESC LIMIT 1`,
      [pullRequestId]
    );
    return row ? mapReviewRun(row) : undefined;
  }

  // ── Indexing Runs ──────────────────────────────────────────────────────────

  async createIndexingRun(input: CreateIndexingRunInput): Promise<IndexingJobRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO indexing_runs (
        id, repository_id, source_ref, status, summary, started_at, completed_at, error_message
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
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
       SET status = COALESCE(?2, status),
           summary = COALESCE(?3, summary),
           completed_at = COALESCE(?4, completed_at),
           error_message = COALESCE(?5, error_message)
       WHERE id = ?1
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
      `SELECT * FROM indexing_runs WHERE repository_id = ?1
       ORDER BY CASE WHEN started_at IS NULL THEN 1 ELSE 0 END, started_at DESC`,
      [repositoryId]
    );
    return rows.map(mapIndexingRun);
  }

  // ── Webhook Events ─────────────────────────────────────────────────────────

  async getWebhookEventByDeliveryId(provider: string, deliveryId: string): Promise<GitHubWebhookEnvelope | undefined> {
    const row = await this.queryOne<Row>(
      `SELECT * FROM webhook_events WHERE provider = ?1 AND delivery_id = ?2 LIMIT 1`,
      [provider, deliveryId]
    );
    return row ? mapWebhookEvent(row) : undefined;
  }

  async recordWebhookEvent(input: GitHubWebhookEnvelope): Promise<GitHubWebhookEnvelope> {
    const row = await this.queryOne<Row>(
      `INSERT INTO webhook_events (
        id, provider, event, delivery_id, signature_256, signature_valid, processing_status, payload, received_at, processed_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
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
        input.signatureValid ? 1 : 0,
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
       SET processing_status = COALESCE(?3, processing_status),
           processed_at = COALESCE(?4, processed_at),
           signature_valid = COALESCE(?5, signature_valid)
       WHERE provider = ?1 AND delivery_id = ?2
       RETURNING *`,
      [provider, deliveryId, patch.processingStatus || null, patch.processedAt || null, patch.signatureValid != null ? (patch.signatureValid ? 1 : 0) : null]
    );
    return row ? mapWebhookEvent(row) : undefined;
  }

  // ── Audit Logs ─────────────────────────────────────────────────────────────

  async appendAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const row = await this.queryOne<Row>(
      `INSERT INTO audit_logs (
        id, workspace_id, actor_user_id, action, resource_type, resource_id, metadata, request_id, created_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
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
      `SELECT * FROM audit_logs WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2`,
      [workspaceId, Math.max(1, limit)]
    );
    return rows.map(mapAuditLog);
  }

  // ── Workspace Secrets ──────────────────────────────────────────────────────

  async upsertWorkspaceSecret(input: UpsertWorkspaceSecretInput): Promise<WorkspaceSecretRecord> {
    const timestamp = nowIso();
    const row = await this.queryOne<Row>(
      `INSERT INTO workspace_secrets (
        id, workspace_id, kind, key_id, encrypted_value, created_by_user_id, created_at, updated_at
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
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
      `SELECT * FROM workspace_secrets WHERE workspace_id = ?1 AND kind = ?2 LIMIT 1`,
      [workspaceId, kind]
    );
    return row ? mapWorkspaceSecret(row) : undefined;
  }

  // ── Indexing (files + chunks) ──────────────────────────────────────────────

  async saveIndexBatch(batch: SemanticIndexBatch): Promise<{ filesCreated: number; chunksCreated: number }> {
    const stmts: D1PreparedStatement[] = [];

    for (const file of batch.files) {
      stmts.push(
        this.db.prepare(
          `INSERT INTO indexed_files (id, repository_id, source_ref, path, blob_sha, content_sha256, language, size_bytes, chunk_strategy, indexed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT (repository_id, source_ref, path) DO UPDATE SET blob_sha = ?5, content_sha256 = ?6, size_bytes = ?8, indexed_at = ?10`
        ).bind(file.id, file.repositoryId, file.sourceRef, file.path, file.blobSha, file.contentSha256, file.language, file.sizeBytes, file.chunkStrategy, file.indexedAt)
      );
    }

    if (batch.chunks.length > 0) {
      stmts.push(
        this.db.prepare(
          `DELETE FROM semantic_chunks WHERE repository_id = ?1 AND source_ref = ?2`
        ).bind(batch.repositoryId, batch.sourceRef)
      );

      for (const chunk of batch.chunks) {
        stmts.push(
          this.db.prepare(
            `INSERT INTO semantic_chunks (id, repository_id, source_ref, file_path, file_content_sha256, language, symbol_kind, symbol_name, chunk_ordinal, start_line, end_line, content, content_sha256, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
          ).bind(chunk.id, chunk.repositoryId, chunk.sourceRef, chunk.filePath, chunk.fileContentSha256, chunk.language, chunk.symbolKind, chunk.symbolName || null, chunk.chunkOrdinal, chunk.startLine, chunk.endLine, chunk.content, chunk.contentSha256, chunk.createdAt)
        );
      }
    }

    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }

    return { filesCreated: batch.files.length, chunksCreated: batch.chunks.length };
  }

  async listIndexedFiles(repositoryId: string, sourceRef?: string): Promise<IndexedFileRecord[]> {
    const rows = sourceRef
      ? await this.query<Row>(`SELECT * FROM indexed_files WHERE repository_id = ?1 AND source_ref = ?2 ORDER BY path`, [repositoryId, sourceRef])
      : await this.query<Row>(`SELECT * FROM indexed_files WHERE repository_id = ?1 ORDER BY path`, [repositoryId]);
    return rows.map(mapIndexedFile);
  }

  async listSemanticChunks(repositoryId: string, sourceRef: string): Promise<SemanticChunkRecord[]> {
    const rows = await this.query<Row>(
      `SELECT * FROM semantic_chunks WHERE repository_id = ?1 AND source_ref = ?2 ORDER BY file_path, chunk_ordinal`,
      [repositoryId, sourceRef]
    );
    return rows.map(mapSemanticChunk);
  }

  async deleteIndexedData(repositoryId: string, sourceRef?: string): Promise<{ filesDeleted: number; chunksDeleted: number }> {
    let chunksDeleted: number;
    let filesDeleted: number;

    if (sourceRef) {
      const chunkResult = await this.execute(`DELETE FROM semantic_chunks WHERE repository_id = ?1 AND source_ref = ?2`, [repositoryId, sourceRef]);
      chunksDeleted = chunkResult.changes;
      const fileResult = await this.execute(`DELETE FROM indexed_files WHERE repository_id = ?1 AND source_ref = ?2`, [repositoryId, sourceRef]);
      filesDeleted = fileResult.changes;
    } else {
      const chunkResult = await this.execute(`DELETE FROM semantic_chunks WHERE repository_id = ?1`, [repositoryId]);
      chunksDeleted = chunkResult.changes;
      const fileResult = await this.execute(`DELETE FROM indexed_files WHERE repository_id = ?1`, [repositoryId]);
      filesDeleted = fileResult.changes;
    }

    return { filesDeleted, chunksDeleted };
  }

  async getIndexingStats(repositoryId: string): Promise<{ totalFiles: number; totalChunks: number; languages: Record<string, number>; lastIndexedAt?: string }> {
    const fileCountRow = await this.queryOne<Row>(`SELECT COUNT(*) AS cnt FROM indexed_files WHERE repository_id = ?1`, [repositoryId]);
    const chunkCountRow = await this.queryOne<Row>(`SELECT COUNT(*) AS cnt FROM semantic_chunks WHERE repository_id = ?1`, [repositoryId]);
    const langRows = await this.query<Row>(`SELECT language, COUNT(*) AS cnt FROM indexed_files WHERE repository_id = ?1 GROUP BY language`, [repositoryId]);
    const lastRow = await this.queryOne<Row>(`SELECT MAX(indexed_at) AS last_indexed FROM indexed_files WHERE repository_id = ?1`, [repositoryId]);

    const languages: Record<string, number> = {};
    for (const row of langRows) {
      languages[row.language as string] = toNumber(row.cnt);
    }

    return {
      totalFiles: toNumber(fileCountRow?.cnt),
      totalChunks: toNumber(chunkCountRow?.cnt),
      languages,
      lastIndexedAt: lastRow?.last_indexed as string | undefined
    };
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

export type CreateControlPlaneDatabaseOptions = {
  d1?: D1Database;
  useInMemory?: boolean;
};

export function createControlPlaneDatabase(options: CreateControlPlaneDatabaseOptions): ControlPlaneDatabase {
  if (options.d1) {
    return new D1ControlPlaneDatabase(options.d1);
  }

  return new InMemoryControlPlaneDatabase();
}
