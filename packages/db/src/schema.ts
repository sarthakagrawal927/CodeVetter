export const TABLES = {
  users: 'users',
  oauthAccounts: 'oauth_accounts',
  sessions: 'sessions',
  workspaces: 'workspaces',
  workspaceMembers: 'workspace_members',
  workspaceInvites: 'workspace_invites',
  githubInstallations: 'github_installations',
  repositories: 'repositories',
  workspaceRuleDefaults: 'workspace_rule_defaults',
  repositoryRuleOverrides: 'repository_rule_overrides',
  pullRequests: 'pull_requests',
  reviewRuns: 'review_runs',
  reviewFindings: 'review_findings',
  indexingRuns: 'indexing_runs',
  webhookEvents: 'webhook_events',
  auditLogs: 'audit_logs',
  workspaceSecrets: 'workspace_secrets',
  repositoryUsage: 'repository_usage'
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];
