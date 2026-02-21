export type ProviderType = 'github';

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

export type RepositoryConnection = {
  id: string;
  workspaceId: string;
  provider: ProviderType;
  owner: string;
  name: string;
  fullName: string;
  installationId?: string;
  defaultBranch?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RuleSeverityThresholds = {
  low: boolean;
  medium: boolean;
  high: boolean;
  critical: boolean;
};

export type RepositoryRuleConfig = {
  repositoryId: string;
  failOnFindings: boolean;
  failOnSeverity: 'low' | 'medium' | 'high' | 'critical';
  maxInlineFindings: number;
  minInlineSeverity: 'low' | 'medium' | 'high' | 'critical';
  reviewTone: 'strict' | 'balanced' | 'friendly';
  blockedPatterns: string[];
  requiredChecks: string[];
  severityThresholds: RuleSeverityThresholds;
  updatedAt: string;
};

export type ReviewRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ReviewRunRecord = {
  id: string;
  repositoryId: string;
  prNumber: number;
  headSha: string;
  status: ReviewRunStatus;
  scoreComposite?: number;
  findingsCount?: number;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type IndexingStatus = 'queued' | 'running' | 'completed' | 'failed';

export type IndexingJobRecord = {
  id: string;
  repositoryId: string;
  status: IndexingStatus;
  sourceRef?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
};

export type ReviewTriggerPayload = {
  repositoryId: string;
  prNumber: number;
  headSha: string;
  triggeredBy: 'webhook' | 'manual' | 'scheduled';
};

export type ReviewJob = {
  kind: 'review';
  payload: ReviewTriggerPayload;
};

export type IndexingJob = {
  kind: 'indexing';
  payload: {
    repositoryId: string;
    sourceRef?: string;
  };
};

export type WorkerJob = ReviewJob | IndexingJob;

export type GitHubWebhookEnvelope = {
  event: string;
  deliveryId: string;
  signature256?: string;
  payload: unknown;
  receivedAt: string;
};
