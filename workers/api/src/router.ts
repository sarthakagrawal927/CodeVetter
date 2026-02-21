import {
  GitHubWebhookEnvelope,
  OrganizationMemberRecord,
  RepositoryRuleConfig,
  ReviewRunRecord,
} from '@code-reviewer/shared-types';
import { HttpContext, HttpResponse } from './http';
import { InMemoryApiStore } from './store';

type RouterDeps = {
  store: InMemoryApiStore;
  authToken?: string;
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
