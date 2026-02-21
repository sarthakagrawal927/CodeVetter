import {
  DriftCheckInput,
  DriftSignal,
  GitHubWebhookEnvelope,
  OrganizationMemberRecord,
  RepositoryRuleConfig,
  ReviewRunRecord,
} from '@code-reviewer/shared-types';
import { GitHubApiError, GitHubClient } from './github';
import { HttpContext, HttpResponse } from './http';
import { InMemoryApiStore } from './store';

type RouterDeps = {
  store: InMemoryApiStore;
  authToken?: string;
  githubClient?: GitHubClient;
};

function requireAuth(context: HttpContext, authToken?: string): HttpResponse | null {
  if (!authToken) {
    return null;
  }

  const headerValue = context.headers.authorization?.trim();
  const expected = `Bearer ${authToken}`;

  if (headerValue !== expected) {
    return {
      status: 401,
      body: {
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header.',
      },
    };
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRuleConfigInput(repositoryId: string, body: unknown): Omit<RepositoryRuleConfig, 'updatedAt'> {
  if (!isObject(body)) {
    throw new Error('Rule config body must be an object.');
  }

  return {
    repositoryId,
    failOnFindings: Boolean(body.failOnFindings),
    failOnSeverity:
      body.failOnSeverity === 'low' ||
      body.failOnSeverity === 'medium' ||
      body.failOnSeverity === 'high' ||
      body.failOnSeverity === 'critical'
        ? body.failOnSeverity
        : 'high',
    maxInlineFindings:
      typeof body.maxInlineFindings === 'number' && Number.isInteger(body.maxInlineFindings)
        ? Math.max(0, Math.min(20, body.maxInlineFindings))
        : 5,
    minInlineSeverity:
      body.minInlineSeverity === 'low' ||
      body.minInlineSeverity === 'medium' ||
      body.minInlineSeverity === 'high' ||
      body.minInlineSeverity === 'critical'
        ? body.minInlineSeverity
        : 'medium',
    reviewTone:
      body.reviewTone === 'strict' || body.reviewTone === 'balanced' || body.reviewTone === 'friendly'
        ? body.reviewTone
        : 'balanced',
    blockedPatterns: Array.isArray(body.blockedPatterns)
      ? body.blockedPatterns.filter((value): value is string => typeof value === 'string')
      : [],
    requiredChecks: Array.isArray(body.requiredChecks)
      ? body.requiredChecks.filter((value): value is string => typeof value === 'string')
      : [],
    severityThresholds: {
      low: body.severityThresholds && isObject(body.severityThresholds) ? Boolean(body.severityThresholds.low) : true,
      medium:
        body.severityThresholds && isObject(body.severityThresholds)
          ? Boolean(body.severityThresholds.medium)
          : true,
      high: body.severityThresholds && isObject(body.severityThresholds) ? Boolean(body.severityThresholds.high) : true,
      critical:
        body.severityThresholds && isObject(body.severityThresholds)
          ? Boolean(body.severityThresholds.critical)
          : true,
    },
  };
}

function parseOrganizationMemberInput(
  organizationId: string,
  body: unknown
): Omit<OrganizationMemberRecord, 'id' | 'createdAt' | 'updatedAt'> {
  if (!isObject(body)) {
    throw new Error('Organization member body must be an object.');
  }

  if (typeof body.githubUserId !== 'string' || !body.githubUserId.trim()) {
    throw new Error('githubUserId is required.');
  }

  if (typeof body.githubLogin !== 'string' || !body.githubLogin.trim()) {
    throw new Error('githubLogin is required.');
  }

  const role =
    body.role === 'owner' || body.role === 'admin' || body.role === 'member'
      ? body.role
      : 'member';
  const status =
    body.status === 'active' || body.status === 'invited' || body.status === 'removed'
      ? body.status
      : 'active';

  return {
    organizationId,
    githubUserId: body.githubUserId.trim(),
    githubLogin: body.githubLogin.trim(),
    role,
    status,
  };
}

function parseDriftCheckInput(body: unknown): DriftCheckInput {
  if (!isObject(body)) {
    return {};
  }

  const expectedRepositoryCount =
    typeof body.expectedRepositoryCount === 'number' &&
    Number.isInteger(body.expectedRepositoryCount) &&
    body.expectedRepositoryCount >= 0
      ? body.expectedRepositoryCount
      : undefined;
  const expectedMemberCount =
    typeof body.expectedMemberCount === 'number' &&
    Number.isInteger(body.expectedMemberCount) &&
    body.expectedMemberCount >= 0
      ? body.expectedMemberCount
      : undefined;
  const expectedInstallationId =
    typeof body.expectedInstallationId === 'string' && body.expectedInstallationId.trim()
      ? body.expectedInstallationId.trim()
      : undefined;

  return {
    expectedRepositoryCount,
    expectedMemberCount,
    expectedInstallationId,
  };
}

function parseRepositoryReference(body: unknown): { owner: string; name: string } {
  if (!isObject(body)) {
    throw new Error('Body must be a JSON object.');
  }

  if (typeof body.owner === 'string' && typeof body.name === 'string') {
    const owner = body.owner.trim();
    const name = body.name.trim();
    if (!owner || !name) {
      throw new Error('owner and name are required.');
    }

    return { owner, name };
  }

  if (typeof body.repository !== 'string') {
    throw new Error('repository string or owner/name fields are required.');
  }

  const raw = body.repository.trim();
  if (!raw) {
    throw new Error('repository input is required.');
  }

  let normalized = raw;
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    if (!/github\.com$/i.test(url.hostname)) {
      throw new Error('Only github.com URLs are supported.');
    }

    normalized = url.pathname;
  }

  normalized = normalized.replace(/^\//, '').replace(/\.git$/i, '').replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Use owner/repo format or full GitHub URL.');
  }

  return {
    owner: parts[0],
    name: parts[1],
  };
}

function buildDriftSignals(
  input: DriftCheckInput,
  observed: {
    repositoryCount: number;
    memberCount: number;
    installationIds: string[];
  }
): DriftSignal[] {
  const signals: DriftSignal[] = [];

  if (
    typeof input.expectedRepositoryCount === 'number' &&
    input.expectedRepositoryCount !== observed.repositoryCount
  ) {
    signals.push({
      code: 'repository_count_mismatch',
      message: `Expected ${input.expectedRepositoryCount} repos but found ${observed.repositoryCount} from GitHub.`,
    });
  }

  if (
    typeof input.expectedMemberCount === 'number' &&
    input.expectedMemberCount !== observed.memberCount
  ) {
    signals.push({
      code: 'member_count_mismatch',
      message: `Expected ${input.expectedMemberCount} members but found ${observed.memberCount} from GitHub.`,
    });
  }

  if (input.expectedInstallationId) {
    if (!observed.installationIds.includes(input.expectedInstallationId)) {
      signals.push({
        code: 'installation_mismatch',
        message: observed.installationIds.length
          ? `Expected installation ${input.expectedInstallationId} but GitHub returned [${observed.installationIds.join(', ')}].`
          : `Expected installation ${input.expectedInstallationId}, but installation id could not be verified from GitHub.`,
      });
    }
  }

  return signals;
}

export async function routeRequest(context: HttpContext, deps: RouterDeps): Promise<HttpResponse> {
  const unauthorized = requireAuth(context, deps.authToken);
  if (unauthorized) {
    return unauthorized;
  }

  if (context.method === 'GET' && context.pathname === '/health') {
    return {
      status: 200,
      body: {
        ok: true,
        service: 'worker-api',
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (context.method === 'GET' && context.pathname === '/v1/repositories') {
    return {
      status: 200,
      body: {
        repositories: deps.store.listRepositories(),
      },
    };
  }

  if (context.method === 'GET' && context.pathname === '/v1/orgs') {
    return {
      status: 200,
      body: {
        organizations: deps.store.listOrganizations(),
      },
    };
  }

  if (context.method === 'POST' && context.pathname === '/v1/orgs') {
    if (!isObject(context.body)) {
      return {
        status: 400,
        body: { error: 'invalid_request', message: 'Body must be JSON object.' },
      };
    }

    if (typeof context.body.slug !== 'string' || !context.body.slug.trim()) {
      return {
        status: 400,
        body: { error: 'invalid_org', message: 'slug is required.' },
      };
    }

    const organization = deps.store.upsertOrganization({
      slug: context.body.slug.trim(),
      displayName:
        typeof context.body.displayName === 'string' && context.body.displayName.trim()
          ? context.body.displayName.trim()
          : context.body.slug.trim(),
      githubOrgId:
        typeof context.body.githubOrgId === 'string' ? context.body.githubOrgId.trim() : undefined,
      githubInstallationId:
        typeof context.body.githubInstallationId === 'string'
          ? context.body.githubInstallationId.trim()
          : undefined,
    });

    return {
      status: 201,
      body: { organization },
    };
  }

  if (context.method === 'POST' && context.pathname === '/v1/github/connect-repository') {
    if (!deps.githubClient) {
      return {
        status: 503,
        body: {
          error: 'github_not_configured',
          message:
            'GitHub token is not configured. Set GITHUB_DRIFT_CHECK_TOKEN or GITHUB_APP_INSTALLATION_TOKEN.',
        },
      };
    }

    if (!isObject(context.body)) {
      return {
        status: 400,
        body: {
          error: 'invalid_request',
          message: 'Body must be a JSON object.',
        },
      };
    }

    const organizationId =
      typeof context.body.organizationId === 'string' ? context.body.organizationId.trim() : '';
    const installationId =
      typeof context.body.installationId === 'string' ? context.body.installationId.trim() : '';
    if (!organizationId || !installationId) {
      return {
        status: 400,
        body: {
          error: 'invalid_connect_payload',
          message: 'organizationId and installationId are required.',
        },
      };
    }

    const organization = deps.store.getOrganization(organizationId);
    if (!organization) {
      return {
        status: 404,
        body: {
          error: 'organization_not_found',
          message: `Unknown organization: ${organizationId}`,
        },
      };
    }

    const repositoryRef = (() => {
      try {
        return parseRepositoryReference(context.body);
      } catch (error) {
        return error instanceof Error ? error : new Error('Invalid repository reference.');
      }
    })();
    if (repositoryRef instanceof Error) {
      return {
        status: 400,
        body: {
          error: 'invalid_repository_reference',
          message: repositoryRef.message,
        },
      };
    }

    let tokenInstallationId: string;
    try {
      tokenInstallationId = await deps.githubClient.getCurrentInstallationId();
    } catch (error) {
      const statusCode = error instanceof GitHubApiError && error.statusCode ? error.statusCode : 502;
      return {
        status: statusCode,
        body: {
          error: 'github_installation_lookup_failed',
          message: error instanceof Error ? error.message : 'Unable to validate installation token.',
        },
      };
    }

    if (tokenInstallationId !== installationId) {
      return {
        status: 409,
        body: {
          error: 'installation_mismatch',
          message:
            `Provided installationId=${installationId} does not match token installationId=${tokenInstallationId}. ` +
            'Use token minted for the same installation.',
        },
      };
    }

    let remoteRepository: Awaited<ReturnType<GitHubClient['getRepository']>>;
    try {
      remoteRepository = await deps.githubClient.getRepository(repositoryRef.owner, repositoryRef.name);
    } catch (error) {
      const statusCode = error instanceof GitHubApiError && error.statusCode ? error.statusCode : 502;
      return {
        status: statusCode,
        body: {
          error: 'github_repository_lookup_failed',
          message: error instanceof Error ? error.message : 'Unable to load repository from GitHub.',
        },
      };
    }

    const repository = deps.store.upsertRepository({
      workspaceId: organizationId,
      provider: 'github',
      owner: remoteRepository.owner,
      name: remoteRepository.name,
      fullName: remoteRepository.fullName,
      installationId,
      defaultBranch: remoteRepository.defaultBranch,
      isActive: true,
    });

    const updatedOrganization = deps.store.upsertOrganization({
      id: organization.id,
      slug: organization.slug,
      displayName: organization.displayName,
      githubOrgId: organization.githubOrgId,
      githubInstallationId: installationId,
    });

    return {
      status: 201,
      body: {
        organization: updatedOrganization,
        repository,
        source: 'github_app_installation',
      },
    };
  }

  const orgMembersMatch = /^\/v1\/orgs\/([^/]+)\/members$/.exec(context.pathname);
  if (orgMembersMatch && context.method === 'GET') {
    const organizationId = orgMembersMatch[1];
    return {
      status: 200,
      body: {
        members: deps.store.listOrganizationMembers(organizationId),
      },
    };
  }

  if (orgMembersMatch && context.method === 'POST') {
    const organizationId = orgMembersMatch[1];
    try {
      const member = deps.store.upsertOrganizationMember(
        parseOrganizationMemberInput(organizationId, context.body)
      );
      return {
        status: 201,
        body: { member },
      };
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'invalid_member_payload',
          message: error instanceof Error ? error.message : 'Unknown validation error.',
        },
      };
    }
  }

  const orgDriftCheckMatch = /^\/v1\/orgs\/([^/]+)\/drift\/check$/.exec(context.pathname);
  if (orgDriftCheckMatch && context.method === 'GET') {
    const organizationId = orgDriftCheckMatch[1];
    if (!deps.store.getOrganization(organizationId)) {
      return {
        status: 404,
        body: { error: 'organization_not_found', message: `Unknown organization: ${organizationId}` },
      };
    }

    const checks = deps.store.listDriftChecks(organizationId);
    return {
      status: 200,
      body: {
        checks,
        latest: checks.length > 0 ? checks[checks.length - 1] : null,
      },
    };
  }

  if (orgDriftCheckMatch && context.method === 'POST') {
    const organizationId = orgDriftCheckMatch[1];
    const organization = deps.store.getOrganization(organizationId);
    if (!organization) {
      return {
        status: 404,
        body: { error: 'organization_not_found', message: `Unknown organization: ${organizationId}` },
      };
    }

    if (!deps.githubClient) {
      return {
        status: 503,
        body: {
          error: 'github_drift_check_not_configured',
          message:
            'Missing GitHub token for live drift checks. Set GITHUB_DRIFT_CHECK_TOKEN (or GITHUB_APP_INSTALLATION_TOKEN).',
        },
      };
    }

    const input = parseDriftCheckInput(context.body);
    let snapshot: Awaited<ReturnType<GitHubClient['getOrganizationSnapshot']>>;
    try {
      snapshot = await deps.githubClient.getOrganizationSnapshot(organization.slug);
    } catch (error) {
      const statusCode = error instanceof GitHubApiError && error.statusCode ? error.statusCode : 502;
      return {
        status: statusCode,
        body: {
          error: 'github_drift_check_failed',
          message: error instanceof Error ? error.message : 'Unknown GitHub API error.',
        },
      };
    }

    const signals = buildDriftSignals(input, {
      repositoryCount: snapshot.repositoryCount,
      memberCount: snapshot.memberCount,
      installationIds: snapshot.installationIds,
    });
    const driftCheck = deps.store.saveDriftCheck({
      organizationId,
      expectedRepositoryCount: input.expectedRepositoryCount,
      expectedMemberCount: input.expectedMemberCount,
      expectedInstallationId: input.expectedInstallationId,
      observedRepositoryCount: snapshot.repositoryCount,
      observedMemberCount: snapshot.memberCount,
      observedInstallationIds: snapshot.installationIds,
      driftDetected: signals.length > 0,
      signals,
    });
    return {
      status: 200,
      body: {
        driftCheck,
        source: 'github_live',
        recommendation: driftCheck.driftDetected ? 'reconcile' : 'none',
      },
    };
  }

  const orgReconcileMatch = /^\/v1\/orgs\/([^/]+)\/reconcile$/.exec(context.pathname);
  if (orgReconcileMatch && context.method === 'GET') {
    const organizationId = orgReconcileMatch[1];
    if (!deps.store.getOrganization(organizationId)) {
      return {
        status: 404,
        body: { error: 'organization_not_found', message: `Unknown organization: ${organizationId}` },
      };
    }

    return {
      status: 200,
      body: {
        runs: deps.store.listReconcileRuns(organizationId),
      },
    };
  }

  if (orgReconcileMatch && context.method === 'POST') {
    const organizationId = orgReconcileMatch[1];
    if (!deps.store.getOrganization(organizationId)) {
      return {
        status: 404,
        body: { error: 'organization_not_found', message: `Unknown organization: ${organizationId}` },
      };
    }

    const latestCheck = deps.store.getLatestDriftCheck(organizationId);
    const force = isObject(context.body) && Boolean(context.body.force);

    if (!latestCheck) {
      return {
        status: 409,
        body: {
          error: 'drift_check_required',
          message: 'Run POST /v1/orgs/:orgId/drift/check before starting reconcile.',
        },
      };
    }

    if (!latestCheck.driftDetected && !force) {
      return {
        status: 409,
        body: {
          error: 'no_drift_detected',
          message: 'Latest drift check shows no drift. Reconcile is blocked unless force=true.',
          driftCheck: latestCheck,
        },
      };
    }

    const run = deps.store.queueReconcileRun({
      organizationId,
      driftCheckId: latestCheck.id,
      reason: latestCheck.driftDetected ? 'drift_detected' : 'forced',
    });

    return {
      status: 202,
      body: {
        run,
        message: 'Manual reconcile queued.',
      },
    };
  }

  if (context.method === 'POST' && context.pathname === '/v1/repositories') {
    if (!isObject(context.body)) {
      return {
        status: 400,
        body: { error: 'invalid_request', message: 'Body must be JSON object.' },
      };
    }

    if (typeof context.body.workspaceId !== 'string' || !context.body.workspaceId.trim()) {
      return {
        status: 400,
        body: { error: 'invalid_workspace', message: 'workspaceId is required.' },
      };
    }

    if (typeof context.body.owner !== 'string' || typeof context.body.name !== 'string') {
      return {
        status: 400,
        body: { error: 'invalid_repo', message: 'owner and name are required.' },
      };
    }

    const repository = deps.store.upsertRepository({
      workspaceId: context.body.workspaceId,
      provider: 'github',
      owner: context.body.owner,
      name: context.body.name,
      fullName: `${context.body.owner}/${context.body.name}`,
      installationId: typeof context.body.installationId === 'string' ? context.body.installationId : undefined,
      defaultBranch: typeof context.body.defaultBranch === 'string' ? context.body.defaultBranch : 'main',
      isActive: true,
    });

    return {
      status: 201,
      body: { repository },
    };
  }

  if (context.method === 'GET' && context.pathname.startsWith('/v1/rules/')) {
    const repositoryId = context.pathname.replace('/v1/rules/', '').trim();
    if (!repositoryId) {
      return {
        status: 400,
        body: { error: 'invalid_repository_id' },
      };
    }

    const config = deps.store.getRuleConfig(repositoryId);
    return {
      status: 200,
      body: {
        config: config || null,
      },
    };
  }

  if ((context.method === 'PUT' || context.method === 'POST') && context.pathname.startsWith('/v1/rules/')) {
    const repositoryId = context.pathname.replace('/v1/rules/', '').trim();
    if (!repositoryId) {
      return {
        status: 400,
        body: { error: 'invalid_repository_id' },
      };
    }

    try {
      const config = deps.store.upsertRuleConfig(parseRuleConfigInput(repositoryId, context.body));
      return {
        status: 200,
        body: { config },
      };
    } catch (error) {
      return {
        status: 400,
        body: {
          error: 'invalid_rule_config',
          message: error instanceof Error ? error.message : 'Unknown validation error.',
        },
      };
    }
  }

  if (context.method === 'GET' && context.pathname === '/v1/reviews') {
    const repositoryId = context.query.get('repositoryId') || undefined;
    return {
      status: 200,
      body: {
        runs: deps.store.listReviewRuns(repositoryId),
      },
    };
  }

  if (context.method === 'POST' && context.pathname === '/v1/reviews/trigger') {
    if (!isObject(context.body)) {
      return {
        status: 400,
        body: {
          error: 'invalid_request',
          message: 'Body must be a JSON object.',
        },
      };
    }

    const repositoryId = typeof context.body.repositoryId === 'string' ? context.body.repositoryId : '';
    const prNumber = typeof context.body.prNumber === 'number' ? context.body.prNumber : NaN;
    const headSha = typeof context.body.headSha === 'string' ? context.body.headSha : '';

    if (!repositoryId || !Number.isInteger(prNumber) || prNumber <= 0 || !headSha) {
      return {
        status: 400,
        body: {
          error: 'invalid_review_payload',
          message: 'repositoryId, prNumber, and headSha are required.',
        },
      };
    }

    const run: ReviewRunRecord = {
      id: `rr_${Date.now()}`,
      repositoryId,
      prNumber,
      headSha,
      status: 'queued',
    };

    deps.store.addReviewRun(run);

    return {
      status: 202,
      body: {
        run,
        message: 'Review run accepted (queue integration pending).',
      },
    };
  }

  if (context.method === 'POST' && context.pathname === '/webhooks/github') {
    const deliveryIdHeader = context.headers['x-github-delivery'];
    const eventHeader = context.headers['x-github-event'];

    const deliveryId = Array.isArray(deliveryIdHeader) ? deliveryIdHeader[0] : deliveryIdHeader;
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (!deliveryId || !event) {
      return {
        status: 400,
        body: {
          error: 'invalid_webhook_headers',
          message: 'x-github-delivery and x-github-event headers are required.',
        },
      };
    }

    const envelope: GitHubWebhookEnvelope = {
      event,
      deliveryId,
      signature256:
        typeof context.headers['x-hub-signature-256'] === 'string'
          ? context.headers['x-hub-signature-256']
          : undefined,
      payload: context.body,
      receivedAt: new Date().toISOString(),
    };

    deps.store.recordWebhookEvent(envelope);

    return {
      status: 202,
      body: {
        accepted: true,
        event,
        deliveryId,
      },
    };
  }

  if (context.method === 'GET' && context.pathname === '/v1/webhooks/events') {
    return {
      status: 200,
      body: {
        events: deps.store.listWebhookEvents(),
      },
    };
  }

  return {
    status: 404,
    body: {
      error: 'not_found',
      message: `No route for ${context.method} ${context.pathname}.`,
    },
  };
}
