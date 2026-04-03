export type ProviderType = 'github';

export type PolicySeverity = 'low' | 'medium' | 'high' | 'critical';

export type ReviewTone = 'strict' | 'balanced' | 'friendly';

export type RuleSeverityThresholds = {
  low: boolean;
  medium: boolean;
  high: boolean;
  critical: boolean;
};

export type RepositoryRuleConfig = {
  repositoryId: string;
  failOnFindings: boolean;
  failOnSeverity: PolicySeverity;
  maxInlineFindings: number;
  minInlineSeverity: PolicySeverity;
  reviewTone: ReviewTone;
  blockedPatterns: string[];
  requiredChecks: string[];
  severityThresholds: RuleSeverityThresholds;
  updatedAt: string;
};

export type WorkspaceRuleDefaults = {
  workspaceId: string;
  schemaVersion: number;
  failOnFindings: boolean;
  failOnSeverity: PolicySeverity;
  maxInlineFindings: number;
  minInlineSeverity: PolicySeverity;
  reviewTone: ReviewTone;
  blockedPatterns: string[];
  requiredChecks: string[];
  severityThresholds: RuleSeverityThresholds;
  updatedByUserId?: string;
  updatedAt: string;
};

export type RepositoryRuleOverride = {
  repositoryId: string;
  schemaVersion: number;
  failOnFindings: boolean;
  failOnSeverity: PolicySeverity;
  maxInlineFindings: number;
  minInlineSeverity: PolicySeverity;
  reviewTone: ReviewTone;
  blockedPatterns: string[];
  requiredChecks: string[];
  severityThresholds: RuleSeverityThresholds;
  updatedByUserId?: string;
  updatedAt: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type WorkspaceMemberStatus = 'active' | 'invited' | 'suspended' | 'removed';

export type WorkspaceKind = 'organization' | 'personal' | 'oss_free';

export type WorkspaceTier = 'free' | 'paid';

export type GitHubAccountType = 'organization' | 'user';

export type UserRecord = {
  id: string;
  githubUserId: string;
  githubLogin: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  sessionTokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRecord = {
  id: string;
  slug: string;
  name: string;
  kind: WorkspaceKind;
  tier: WorkspaceTier;
  githubAccountType?: GitHubAccountType;
  githubAccountId?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMemberRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  githubUserId: string;
  githubLogin: string;
  role: WorkspaceRole;
  status: WorkspaceMemberStatus;
  invitedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export type WorkspaceInviteRecord = {
  id: string;
  workspaceId: string;
  inviteTokenHash: string;
  inviteeGithubLogin?: string;
  inviteeEmail?: string;
  role: WorkspaceRole;
  status: WorkspaceInviteStatus;
  invitedByUserId: string;
  acceptedByUserId?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type GitHubInstallationRecord = {
  id: string;
  workspaceId: string;
  installationId: string;
  accountType: GitHubAccountType;
  accountId: string;
  accountLogin?: string;
  createdAt: string;
  updatedAt: string;
};

export type RepositoryConnection = {
  id: string;
  workspaceId: string;
  provider: ProviderType;
  owner: string;
  name: string;
  fullName: string;
  githubRepoId?: string;
  installationId?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PullRequestState = 'open' | 'closed' | 'merged';

export type PullRequestRecord = {
  id: string;
  repositoryId: string;
  githubPrId?: string;
  prNumber: number;
  title?: string;
  authorGithubLogin?: string;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  state: PullRequestState;
  isAgentAuthored: boolean;
  agentName?: string;
  mergedAt?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ReviewMode = 'standard' | 'agent';

export type ReviewAction = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export type ReviewRunRecord = {
  id: string;
  repositoryId: string;
  pullRequestId?: string;
  prNumber: number;
  headSha: string;
  triggerSource?: 'webhook' | 'manual' | 'scheduled' | 'action';
  status: ReviewRunStatus;
  reviewMode: ReviewMode;
  reviewAction: ReviewAction;
  parentReviewRunId?: string;
  scoreVersion?: string;
  scoreComposite?: number;
  findingsCount?: number;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type ReviewFindingStatus = 'open' | 'resolved';

export type ReviewFindingRecord = {
  id: string;
  reviewRunId: string;
  severity: PolicySeverity;
  title: string;
  summary: string;
  suggestion?: string;
  filePath?: string;
  line?: number;
  confidence?: number;
  status: ReviewFindingStatus;
  findingFingerprint?: string;
  createdAt: string;
};

export type IndexingStatus = 'queued' | 'running' | 'completed' | 'failed';

export type IndexingJobRecord = {
  id: string;
  repositoryId: string;
  status: IndexingStatus;
  sourceRef?: string;
  summary?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type IndexingChunkStrategy = 'tree-sitter';

export type IndexedCodeLanguage =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'python'
  | 'go'
  | 'java'
  | 'csharp'
  | 'ruby'
  | 'php'
  | 'rust'
  | 'kotlin'
  | 'swift'
  | 'sql'
  | 'yaml'
  | 'json'
  | 'markdown'
  | 'other';

export type IndexedSymbolKind =
  | 'module'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'const'
  | 'block';

export type IndexedFileRecord = {
  id: string;
  repositoryId: string;
  sourceRef: string;
  path: string;
  blobSha: string;
  contentSha256: string;
  language: IndexedCodeLanguage;
  sizeBytes: number;
  indexedAt: string;
  chunkStrategy: IndexingChunkStrategy;
};

export type SemanticChunkRecord = {
  id: string;
  repositoryId: string;
  sourceRef: string;
  filePath: string;
  fileContentSha256: string;
  language: IndexedCodeLanguage;
  symbolKind: IndexedSymbolKind;
  symbolName?: string;
  chunkOrdinal: number;
  startLine: number;
  endLine: number;
  content: string;
  contentSha256: string;
  createdAt: string;
};

export type SemanticIndexBatch = {
  repositoryId: string;
  sourceRef: string;
  strategy: IndexingChunkStrategy;
  files: IndexedFileRecord[];
  chunks: SemanticChunkRecord[];
};

export type DriftSignalCode =
  | 'repository_count_mismatch'
  | 'member_count_mismatch'
  | 'installation_mismatch'
  | 'webhook_stale';

export type DriftSignal = {
  code: DriftSignalCode;
  message: string;
};

export type DriftCheckInput = {
  expectedRepositoryCount?: number;
  expectedMemberCount?: number;
  expectedInstallationId?: string;
};

export type DriftCheckRecord = {
  id: string;
  organizationId: string;
  checkedAt: string;
  expectedRepositoryCount?: number;
  expectedMemberCount?: number;
  expectedInstallationId?: string;
  observedRepositoryCount: number;
  observedMemberCount: number;
  observedInstallationIds: string[];
  driftDetected: boolean;
  signals: DriftSignal[];
};

export type ReconcileRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ReconcileRunRecord = {
  id: string;
  organizationId: string;
  status: ReconcileRunStatus;
  requestedBy: 'manual';
  triggeredAt: string;
  driftCheckId?: string;
  reason: 'drift_detected' | 'forced';
  completedAt?: string;
  errorMessage?: string;
};

export type WebhookEventProcessingStatus = 'received' | 'processed' | 'ignored' | 'failed';

export type GitHubWebhookEnvelope = {
  id?: string;
  event: string;
  deliveryId: string;
  signature256?: string;
  signatureValid?: boolean;
  processingStatus?: WebhookEventProcessingStatus;
  payload: unknown;
  receivedAt: string;
  processedAt?: string;
};

export type AuditLogRecord = {
  id: string;
  workspaceId?: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata: Record<string, unknown>;
  requestId?: string;
  createdAt: string;
};

export type WorkspaceSecretKind = 'gateway_api_key';

export type WorkspaceSecretRecord = {
  id: string;
  workspaceId: string;
  kind: WorkspaceSecretKind;
  keyId?: string;
  encryptedValue: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type OAuthStatePayload = {
  nonce: string;
  redirectTo?: string;
};

export type AuthSessionUser = {
  id: string;
  githubUserId: string;
  githubLogin: string;
  displayName?: string;
  avatarUrl?: string;
};

export type AuthSessionWorkspace = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
};

export type AuthSessionResponse = {
  authenticated: boolean;
  user?: AuthSessionUser;
  workspaces: AuthSessionWorkspace[];
};

export type CreateWorkspaceRequest = {
  slug: string;
  name: string;
  kind: WorkspaceKind;
  githubAccountType?: GitHubAccountType;
  githubAccountId?: string;
};

export type CreateInviteRequest = {
  role: WorkspaceRole;
  inviteeGithubLogin?: string;
  inviteeEmail?: string;
  expiresInHours?: number;
};

export type UpdateWorkspaceMemberRequest = {
  role?: WorkspaceRole;
  status?: WorkspaceMemberStatus;
};

export type CreateActionReviewTriggerRequest = {
  repositoryFullName: string;
  prNumber: number;
  headSha?: string;
  workflowRunId?: string;
};

export type ReviewTriggerPayload = {
  repositoryId: string;
  prNumber: number;
  headSha: string;
  triggeredBy: 'webhook' | 'manual' | 'scheduled';
};

export type ReviewJob = {
  kind: 'review';
  payload: {
    reviewRunId?: string;
    repositoryId: string;
    prNumber: number;
    headSha: string;
    triggeredBy: 'webhook' | 'manual' | 'action';
    reviewTier?: WorkspaceTier;
  };
};

export type RepositoryUsageRecord = {
  id: string;
  repositoryId: string;
  period: string;
  reviewCount: number;
  lastReviewAt?: string;
};

export type IndexingJob = {
  kind: 'indexing';
  payload: {
    indexingRunId?: string;
    repositoryId: string;
    sourceRef?: string;
  };
};

export type WorkerJob = ReviewJob | IndexingJob;

export type OrganizationRecord = {
  id: string;
  slug: string;
  displayName: string;
  githubOrgId?: string;
  githubInstallationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMemberRole = 'owner' | 'admin' | 'member';

export type OrganizationMemberStatus = 'active' | 'invited' | 'removed';

export type OrganizationMemberRecord = {
  id: string;
  organizationId: string;
  githubUserId: string;
  githubLogin: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  createdAt: string;
  updatedAt: string;
};
