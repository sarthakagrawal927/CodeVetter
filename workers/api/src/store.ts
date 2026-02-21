import {
  GitHubWebhookEnvelope,
  OrganizationMemberRecord,
  OrganizationRecord,
  RepositoryConnection,
  RepositoryRuleConfig,
  ReviewRunRecord,
} from '@code-reviewer/shared-types';

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryApiStore {
  private organizations = new Map<string, OrganizationRecord>();
  private organizationMembers = new Map<string, OrganizationMemberRecord>();
  private repositories = new Map<string, RepositoryConnection>();
  private rules = new Map<string, RepositoryRuleConfig>();
  private reviewRuns = new Map<string, ReviewRunRecord>();
  private webhookEvents: GitHubWebhookEnvelope[] = [];

  listOrganizations(): OrganizationRecord[] {
    return Array.from(this.organizations.values());
  }

  upsertOrganization(
    input: Omit<OrganizationRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): OrganizationRecord {
    const existing =
      (input.id ? this.organizations.get(input.id) : undefined) ||
      Array.from(this.organizations.values()).find(org => org.slug === input.slug);
    const id = existing?.id ?? input.id ?? `org_${this.organizations.size + 1}`;
    const timestamp = nowIso();

    const organization: OrganizationRecord = {
      ...input,
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.organizations.set(id, organization);
    return organization;
  }

  listOrganizationMembers(organizationId: string): OrganizationMemberRecord[] {
    return Array.from(this.organizationMembers.values()).filter(
      member => member.organizationId === organizationId
    );
  }

  upsertOrganizationMember(
    input: Omit<OrganizationMemberRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): OrganizationMemberRecord {
    const existing =
      (input.id ? this.organizationMembers.get(input.id) : undefined) ||
      Array.from(this.organizationMembers.values()).find(
        member =>
          member.organizationId === input.organizationId && member.githubUserId === input.githubUserId
      );
    const id = existing?.id ?? input.id ?? `member_${this.organizationMembers.size + 1}`;
    const timestamp = nowIso();

    const member: OrganizationMemberRecord = {
      ...input,
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.organizationMembers.set(id, member);
    return member;
  }

  listRepositories(): RepositoryConnection[] {
    return Array.from(this.repositories.values());
  }

  getRepositoryByFullName(fullName: string): RepositoryConnection | undefined {
    return Array.from(this.repositories.values()).find(repo => repo.fullName === fullName);
  }

  upsertRepository(input: Omit<RepositoryConnection, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): RepositoryConnection {
    const existing = input.id ? this.repositories.get(input.id) : this.getRepositoryByFullName(input.fullName);
    const id = existing?.id ?? input.id ?? `repo_${this.repositories.size + 1}`;
    const timestamp = nowIso();

    const repository: RepositoryConnection = {
      ...input,
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    this.repositories.set(id, repository);
    return repository;
  }

  getRuleConfig(repositoryId: string): RepositoryRuleConfig | undefined {
    return this.rules.get(repositoryId);
  }

  upsertRuleConfig(config: Omit<RepositoryRuleConfig, 'updatedAt'>): RepositoryRuleConfig {
    const next: RepositoryRuleConfig = {
      ...config,
      updatedAt: nowIso(),
    };

    this.rules.set(config.repositoryId, next);
    return next;
  }

  addReviewRun(run: ReviewRunRecord): ReviewRunRecord {
    this.reviewRuns.set(run.id, run);
    return run;
  }

  listReviewRuns(repositoryId?: string): ReviewRunRecord[] {
    const values = Array.from(this.reviewRuns.values());
    return repositoryId ? values.filter(item => item.repositoryId === repositoryId) : values;
  }

  recordWebhookEvent(event: GitHubWebhookEnvelope): void {
    this.webhookEvents.push(event);
  }

  listWebhookEvents(limit = 50): GitHubWebhookEnvelope[] {
    return this.webhookEvents.slice(-limit);
  }
}
