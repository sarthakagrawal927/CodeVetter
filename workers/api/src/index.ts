import {
  AuthSessionResponse,
  CreateActionReviewTriggerRequest,
  CreateInviteRequest,
  CreateWorkspaceRequest,
  GitHubWebhookEnvelope,
  PullRequestRecord,
  RepositoryConnection,
  RepositoryRuleConfig,
  ReviewRunRecord,
  ReviewSeverity,
  SessionRecord,
  UpdateWorkspaceMemberRequest,
  UserRecord,
  WorkspaceMemberRecord,
  WorkspaceRuleDefaults,
  WorkspaceTier
} from '@code-reviewer/shared-types';
import {
  ControlPlaneDatabase,
  createControlPlaneDatabase,
  UpsertGithubUserInput
} from '@code-reviewer/db';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Context, Hono } from 'hono';
import { detectAgent } from './agentDetection';

type ApiWorkerBindings = {
  DB: D1Database;
  API_WORKER_CORS_ORIGIN?: string;
  APP_BASE_URL?: string;
  SESSION_COOKIE_NAME?: string;
  SESSION_COOKIE_DOMAIN?: string;
  SESSION_SECRET?: string;
  SESSION_TTL_HOURS?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_OAUTH_REDIRECT_URI?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_API_BASE_URL?: string;
  GITHUB_SYNC_TOKEN?: string;
  PLATFORM_ACTION_TOKEN?: string;
  WORKSPACE_SECRET_ENCRYPTION_KEY?: string;
};

type ApiWorkerVariables = {
  requestId: string;
};

const app = new Hono<{ Bindings: ApiWorkerBindings; Variables: ApiWorkerVariables }>();
let db: ControlPlaneDatabase = createControlPlaneDatabase({ useInMemory: true });
let dbConfigFingerprint = '';
const rateLimiterState = new Map<string, { count: number; resetAt: number }>();

let secretsValidated = false;
function validateSecrets(env: ApiWorkerBindings): void {
  if (secretsValidated) return;
  secretsValidated = true;
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    console.warn('[config] GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing — OAuth will not work');
  }
  if (!env.GITHUB_WEBHOOK_SECRET) {
    console.warn('[config] GITHUB_WEBHOOK_SECRET missing — webhook signature validation disabled');
  }
  if (!env.SESSION_SECRET) {
    console.warn('[config] SESSION_SECRET missing — sessions will use insecure default');
  }
}

type ApiContext = Context<{ Bindings: ApiWorkerBindings; Variables: ApiWorkerVariables }>;

const DEFAULT_SESSION_COOKIE_NAME = 'cr_session';
const DEFAULT_SESSION_TTL_HOURS = 24 * 7;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const ACTION_SCORE_VERSION = 'v1.0.0';

const DEFAULT_RULE_THRESHOLDS = {
  low: true,
  medium: true,
  high: true,
  critical: true
} as const;

const FREE_TIER_PR_LIMIT = 10;

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function getCorsOrigin(env: ApiWorkerBindings, requestOrigin?: string): string {
  const configured = env.API_WORKER_CORS_ORIGIN?.trim() || '*';
  if (configured === '*' && requestOrigin) {
    return requestOrigin;
  }

  return configured;
}

function getSessionCookieName(env: ApiWorkerBindings): string {
  return env.SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME;
}

function getSessionSecret(env: ApiWorkerBindings): string {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error('SESSION_SECRET is required but not set');
  }
  return secret;
}

function getSessionTtlHours(env: ApiWorkerBindings): number {
  const raw = env.SESSION_TTL_HOURS?.trim();
  if (!raw) {
    return DEFAULT_SESSION_TTL_HOURS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24 * 30) {
    return DEFAULT_SESSION_TTL_HOURS;
  }

  return parsed;
}

function getRateLimitWindowMs(env: ApiWorkerBindings): number {
  const raw = env.RATE_LIMIT_WINDOW_MS?.trim();
  if (!raw) {
    return DEFAULT_RATE_LIMIT_WINDOW_MS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1_000) {
    return DEFAULT_RATE_LIMIT_WINDOW_MS;
  }

  return parsed;
}

function getRateLimitMaxRequests(env: ApiWorkerBindings): number {
  const raw = env.RATE_LIMIT_MAX_REQUESTS?.trim();
  if (!raw) {
    return DEFAULT_RATE_LIMIT_MAX_REQUESTS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 5) {
    return DEFAULT_RATE_LIMIT_MAX_REQUESTS;
  }

  return parsed;
}

function resolveControlPlaneDb(env: ApiWorkerBindings): ControlPlaneDatabase {
  const fingerprint = env.DB ? 'd1' : 'memory';

  if (fingerprint === dbConfigFingerprint) {
    return db;
  }

  db = createControlPlaneDatabase({ d1: env.DB });
  dbConfigFingerprint = fingerprint;

  return db;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function encodeBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes)
    .map(byte => String.fromCharCode(byte))
    .join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

function equalConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map(chunk => chunk.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(signature))
    .map(chunk => chunk.toString(16).padStart(2, '0'))
    .join('');
}

async function randomToken(bytes = 32): Promise<string> {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return encodeBase64Url(buffer);
}

type OAuthStatePayload = {
  nonce: string;
  redirectTo?: string;
  inviteToken?: string;
  issuedAt: number;
};

async function signOauthState(payload: OAuthStatePayload, secret: string): Promise<string> {
  const rawPayload = JSON.stringify(payload);
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(rawPayload));
  const signature = await hmacSha256Hex(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function verifyOauthState(state: string, secret: string): Promise<OAuthStatePayload | null> {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await hmacSha256Hex(secret, encodedPayload);
  if (!equalConstantTime(expectedSignature, signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as OAuthStatePayload;
    if (!parsed || typeof parsed.issuedAt !== 'number' || typeof parsed.nonce !== 'string') {
      return null;
    }

    if (Date.now() - parsed.issuedAt > OAUTH_STATE_TTL_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function createSessionTokenRecord(
  env: ApiWorkerBindings,
  user: UserRecord,
  ipAddress?: string,
  userAgent?: string
): Promise<{ session: SessionRecord; sessionToken: string }> {
  const sessionToken = await randomToken();
  const sessionTokenHash = await sha256Hex(`${getSessionSecret(env)}:${sessionToken}`);
  const expiresAt = new Date(Date.now() + getSessionTtlHours(env) * 3600_000).toISOString();
  const session = await db.createSession({
    userId: user.id,
    sessionTokenHash,
    expiresAt,
    ipAddress,
    userAgent
  });
  return { session, sessionToken };
}

function readBearerToken(headerValue?: string): string | null {
  if (!headerValue) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
}

function roleRank(role: WorkspaceMemberRecord['role']): number {
  switch (role) {
    case 'owner':
      return 4;
    case 'admin':
      return 3;
    case 'member':
      return 2;
    case 'viewer':
      return 1;
    default:
      return 0;
  }
}

function hasRole(member: WorkspaceMemberRecord, required: WorkspaceMemberRecord['role'][]): boolean {
  return required.some(role => roleRank(member.role) >= roleRank(role));
}

function defaultWorkspaceRuleDefaults(workspaceId: string, updatedByUserId?: string): WorkspaceRuleDefaults {
  return {
    workspaceId,
    schemaVersion: 1,
    failOnFindings: false,
    failOnSeverity: 'high',
    maxInlineFindings: 5,
    minInlineSeverity: 'medium',
    reviewTone: 'balanced',
    blockedPatterns: [],
    requiredChecks: [],
    severityThresholds: {
      ...DEFAULT_RULE_THRESHOLDS
    },
    updatedByUserId,
    updatedAt: nowIso()
  };
}

function toRepositoryRuleConfig(
  input: WorkspaceRuleDefaults | RepositoryRuleConfig,
  repositoryId: string
): RepositoryRuleConfig {
  return {
    repositoryId,
    failOnFindings: input.failOnFindings,
    failOnSeverity: input.failOnSeverity,
    maxInlineFindings: input.maxInlineFindings,
    minInlineSeverity: input.minInlineSeverity,
    reviewTone: input.reviewTone,
    blockedPatterns: input.blockedPatterns,
    requiredChecks: input.requiredChecks,
    severityThresholds: input.severityThresholds,
    updatedAt: input.updatedAt
  };
}

function parseRuleSeverity(value: unknown, fallback: ReviewSeverity): ReviewSeverity {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value;
  }
  return fallback;
}

function parseRuleInput(
  payload: unknown,
  fallback: WorkspaceRuleDefaults | RepositoryRuleConfig,
  repositoryId?: string
): RepositoryRuleConfig {
  const fallbackConfig = toRepositoryRuleConfig(
    fallback,
    repositoryId || ('repositoryId' in fallback ? fallback.repositoryId : '')
  );

  if (!isObject(payload)) {
    return {
      ...fallbackConfig
    };
  }

  return {
    repositoryId: fallbackConfig.repositoryId,
    failOnFindings:
      typeof payload.failOnFindings === 'boolean' ? payload.failOnFindings : fallbackConfig.failOnFindings,
    failOnSeverity: parseRuleSeverity(payload.failOnSeverity, fallbackConfig.failOnSeverity),
    maxInlineFindings:
      typeof payload.maxInlineFindings === 'number' && Number.isInteger(payload.maxInlineFindings)
        ? Math.max(0, Math.min(20, payload.maxInlineFindings))
        : fallbackConfig.maxInlineFindings,
    minInlineSeverity: parseRuleSeverity(payload.minInlineSeverity, fallbackConfig.minInlineSeverity),
    reviewTone:
      payload.reviewTone === 'strict' || payload.reviewTone === 'balanced' || payload.reviewTone === 'friendly'
        ? payload.reviewTone
        : fallbackConfig.reviewTone,
    blockedPatterns: Array.isArray(payload.blockedPatterns)
      ? payload.blockedPatterns.filter((value): value is string => typeof value === 'string')
      : fallbackConfig.blockedPatterns,
    requiredChecks: Array.isArray(payload.requiredChecks)
      ? payload.requiredChecks.filter((value): value is string => typeof value === 'string')
      : fallbackConfig.requiredChecks,
    severityThresholds: {
      low:
        payload.severityThresholds && isObject(payload.severityThresholds)
          ? Boolean(payload.severityThresholds.low)
          : fallbackConfig.severityThresholds.low,
      medium:
        payload.severityThresholds && isObject(payload.severityThresholds)
          ? Boolean(payload.severityThresholds.medium)
          : fallbackConfig.severityThresholds.medium,
      high:
        payload.severityThresholds && isObject(payload.severityThresholds)
          ? Boolean(payload.severityThresholds.high)
          : fallbackConfig.severityThresholds.high,
      critical:
        payload.severityThresholds && isObject(payload.severityThresholds)
          ? Boolean(payload.severityThresholds.critical)
          : fallbackConfig.severityThresholds.critical
    },
    updatedAt: nowIso()
  };
}

async function resolveSession(c: ApiContext): Promise<{
  session: SessionRecord;
  user: UserRecord;
} | null> {
  const cookieName = getSessionCookieName(c.env);
  const sessionToken = getCookie(c, cookieName);
  if (!sessionToken) {
    return null;
  }

  const sessionTokenHash = await sha256Hex(`${getSessionSecret(c.env)}:${sessionToken}`);
  const session = await db.getSessionByTokenHash(sessionTokenHash);
  if (!session) {
    return null;
  }

  if (session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    await db.revokeSession(session.id);
    return null;
  }

  const user = await db.getUserById(session.userId);
  if (!user) {
    return null;
  }

  return { session, user };
}

async function requireSession(c: ApiContext): Promise<{ session: SessionRecord; user: UserRecord } | Response> {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return jsonResponse(
      {
        error: 'unauthorized',
        message: 'Authentication required.'
      },
      401
    );
  }

  return resolved;
}

async function requireWorkspaceMember(
  c: ApiContext,
  workspaceId: string,
  allowedRoles: WorkspaceMemberRecord['role'][]
): Promise<{ member: WorkspaceMemberRecord; workspace: Awaited<ReturnType<typeof db.getWorkspaceById>> } | Response> {
  const auth = await requireSession(c);
  if (auth instanceof Response) {
    return auth;
  }

  const workspace = await db.getWorkspaceById(workspaceId);
  if (!workspace) {
    return jsonResponse(
      {
        error: 'workspace_not_found',
        message: `Unknown workspace: ${workspaceId}`
      },
      404
    );
  }

  const member = await db.getWorkspaceMember(workspaceId, auth.user.id);
  if (!member || member.status !== 'active') {
    return jsonResponse(
      {
        error: 'forbidden',
        message: 'Workspace membership required.'
      },
      403
    );
  }

  if (!hasRole(member, allowedRoles)) {
    return jsonResponse(
      {
        error: 'forbidden',
        message: `Role ${member.role} cannot perform this action.`
      },
      403
    );
  }

  return {
    member,
    workspace
  };
}

async function parseJsonBody(c: ApiContext): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

async function githubExchangeCodeForAccessToken(env: ApiWorkerBindings, code: string): Promise<string> {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const redirectUri = env.GITHUB_OAUTH_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('GitHub OAuth is not configured. Missing GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET/GITHUB_OAUTH_REDIRECT_URI.');
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(
      typeof payload.error_description === 'string'
        ? payload.error_description
        : 'Unable to exchange GitHub OAuth code.'
    );
  }

  return payload.access_token;
}

async function githubFetchCurrentUser(accessToken: string): Promise<UpsertGithubUserInput> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'code-reviewer-worker-api',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.id !== 'number' || typeof payload.login !== 'string') {
    throw new Error('Unable to load authenticated GitHub user profile.');
  }

  return {
    githubUserId: String(payload.id),
    githubLogin: payload.login,
    displayName: typeof payload.name === 'string' ? payload.name : undefined,
    avatarUrl: typeof payload.avatar_url === 'string' ? payload.avatar_url : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined
  };
}

type SyncRepositoryInput = {
  id?: string;
  owner: string;
  name: string;
  fullName?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
};

async function githubListCurrentInstallationRepositories(token: string): Promise<SyncRepositoryInput[]> {
  const response = await fetch('https://api.github.com/installation/repositories?per_page=100', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'code-reviewer-worker-api',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || !Array.isArray(payload.repositories)) {
    throw new Error('Unable to load installation repositories from GitHub.');
  }

  const repositories: SyncRepositoryInput[] = [];

  for (const value of payload.repositories) {
    if (!isObject(value)) {
      continue;
    }

    const owner = isObject(value.owner) && typeof value.owner.login === 'string' ? value.owner.login : undefined;
    const name = typeof value.name === 'string' ? value.name : undefined;
    if (!owner || !name) {
      continue;
    }

    repositories.push({
      id: typeof value.id === 'number' ? String(value.id) : undefined,
      owner,
      name,
      fullName: typeof value.full_name === 'string' ? value.full_name : `${owner}/${name}`,
      defaultBranch: typeof value.default_branch === 'string' ? value.default_branch : 'main',
      isPrivate: typeof value.private === 'boolean' ? value.private : undefined
    });
  }

  return repositories;
}

async function getAllRepositories(): Promise<RepositoryConnection[]> {
  return db.listAllRepositories();
}

async function encryptSecret(env: ApiWorkerBindings, plaintext: string): Promise<string> {
  const keyMaterialSource = env.WORKSPACE_SECRET_ENCRYPTION_KEY?.trim() || getSessionSecret(env);
  const keyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyMaterialSource));
  const normalizedKey = new Uint8Array(keyDigest).slice(0, 32);

  const key = await crypto.subtle.importKey('raw', normalizedKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    new TextEncoder().encode(plaintext)
  );

  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

async function verifyGitHubWebhookSignature(env: ApiWorkerBindings, rawBody: string, signatureHeader?: string): Promise<boolean> {
  const secret = env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return false;
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expected = `sha256=${await hmacSha256Hex(secret, rawBody)}`;
  return equalConstantTime(expected, signatureHeader);
}

function parseGitHubRepositoryReference(payload: unknown): { fullName: string; owner: string; name: string } | null {
  if (!isObject(payload) || !isObject(payload.repository)) {
    return null;
  }

  const repository = payload.repository;
  const fullName = typeof repository.full_name === 'string' ? repository.full_name : undefined;
  const owner = isObject(repository.owner) && typeof repository.owner.login === 'string' ? repository.owner.login : undefined;
  const name = typeof repository.name === 'string' ? repository.name : undefined;

  if (!fullName || !owner || !name) {
    return null;
  }

  return {
    fullName,
    owner,
    name
  };
}

function parsePullRequestPayload(payload: unknown): {
  githubPrId?: string;
  prNumber: number;
  title?: string;
  authorGithubLogin?: string;
  baseRef?: string;
  headRef?: string;
  headSha?: string;
  state: PullRequestRecord['state'];
} | null {
  if (!isObject(payload) || !isObject(payload.pull_request) || typeof payload.number !== 'number') {
    return null;
  }

  const pr = payload.pull_request;
  const stateRaw = typeof pr.state === 'string' ? pr.state : 'open';
  const merged = Boolean(pr.merged);
  const normalizedState: PullRequestRecord['state'] = merged
    ? 'merged'
    : stateRaw === 'closed'
      ? 'closed'
      : 'open';

  return {
    githubPrId: typeof pr.id === 'number' ? String(pr.id) : undefined,
    prNumber: payload.number,
    title: typeof pr.title === 'string' ? pr.title : undefined,
    authorGithubLogin: isObject(pr.user) && typeof pr.user.login === 'string' ? pr.user.login : undefined,
    baseRef: isObject(pr.base) && typeof pr.base.ref === 'string' ? pr.base.ref : undefined,
    headRef: isObject(pr.head) && typeof pr.head.ref === 'string' ? pr.head.ref : undefined,
    headSha: isObject(pr.head) && typeof pr.head.sha === 'string' ? pr.head.sha : undefined,
    state: normalizedState
  };
}

function actionCanTriggerReview(action: string): boolean {
  return action === 'opened' || action === 'reopened' || action === 'synchronize';
}

app.use('*', async (c, next) => {
  resolveControlPlaneDb(c.env);
  validateSecrets(c.env);

  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);

  const corsOrigin = getCorsOrigin(c.env, c.req.header('origin') || undefined);

  if (c.req.method === 'OPTIONS') {
    const response = new Response(null, { status: 204 });
    response.headers.set('access-control-allow-origin', corsOrigin);
    response.headers.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.headers.set('access-control-allow-headers', 'content-type,authorization,x-github-delivery,x-github-event,x-hub-signature-256');
    response.headers.set('access-control-allow-credentials', 'true');
    response.headers.set('vary', 'origin');
    response.headers.set('access-control-max-age', '600');
    response.headers.set('x-request-id', requestId);
    return response;
  }

  const rateLimitWindowMs = getRateLimitWindowMs(c.env);
  const rateLimitMaxRequests = getRateLimitMaxRequests(c.env);
  const rateKey = c.req.header('cf-connecting-ip') || 'global';
  const current = rateLimiterState.get(rateKey);
  const now = Date.now();

  if (!current || current.resetAt <= now) {
    rateLimiterState.set(rateKey, {
      count: 1,
      resetAt: now + rateLimitWindowMs
    });
  } else {
    current.count += 1;
    if (current.count > rateLimitMaxRequests) {
      const response = jsonResponse(
        {
          error: 'rate_limited',
          message: 'Too many requests. Slow down and retry shortly.'
        },
        429
      );
      response.headers.set('retry-after', String(Math.ceil((current.resetAt - now) / 1000)));
      response.headers.set('x-request-id', requestId);
      response.headers.set('access-control-allow-origin', corsOrigin);
      response.headers.set('access-control-allow-credentials', 'true');
      response.headers.set('vary', 'origin');
      return response;
    }
  }

  await next();

  c.res.headers.set('access-control-allow-origin', corsOrigin);
  c.res.headers.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  c.res.headers.set('access-control-allow-headers', 'content-type,authorization,x-github-delivery,x-github-event,x-hub-signature-256');
  c.res.headers.set('access-control-allow-credentials', 'true');
  c.res.headers.set('vary', 'origin');
  c.res.headers.set('x-request-id', requestId);
});

app.get('/health', c => {
  return jsonResponse({
    ok: true,
    service: 'worker-api-v1',
    timestamp: nowIso()
  });
});

app.get('/v1/auth/github/start', async c => {
  const clientId = c.env.GITHUB_CLIENT_ID?.trim();
  const redirectUri = c.env.GITHUB_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    return jsonResponse(
      {
        error: 'github_oauth_not_configured',
        message: 'GitHub OAuth is not configured in worker bindings.'
      },
      503
    );
  }

  const redirectTo = c.req.query('redirectTo') || '/onboarding';
  const inviteToken = c.req.query('inviteToken') || undefined;

  const state = await signOauthState(
    {
      nonce: await randomToken(10),
      redirectTo,
      inviteToken,
      issuedAt: Date.now()
    },
    getSessionSecret(c.env)
  );

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', 'read:user user:email');
  githubAuthUrl.searchParams.set('state', state);

  return c.redirect(githubAuthUrl.toString(), 302);
});

app.get('/v1/auth/github/callback', async c => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return jsonResponse(
      {
        error: 'invalid_oauth_callback',
        message: 'code and state are required.'
      },
      400
    );
  }

  const parsedState = await verifyOauthState(state, getSessionSecret(c.env));
  if (!parsedState) {
    return jsonResponse(
      {
        error: 'invalid_oauth_state',
        message: 'State is invalid or expired.'
      },
      400
    );
  }

  let userProfile: UpsertGithubUserInput;
  try {
    const accessToken = await githubExchangeCodeForAccessToken(c.env, code);
    userProfile = await githubFetchCurrentUser(accessToken);
  } catch (error) {
    return jsonResponse(
      {
        error: 'github_oauth_failed',
        message: error instanceof Error ? error.message : 'OAuth callback failed.'
      },
      502
    );
  }

  const user = await db.upsertUserFromGithub(userProfile);

  if (parsedState.inviteToken) {
    const inviteTokenHash = await sha256Hex(`${getSessionSecret(c.env)}:${parsedState.inviteToken}`);
    const invite = await db.getWorkspaceInviteByTokenHash(inviteTokenHash);
    if (invite && invite.status === 'pending' && new Date(invite.expiresAt).getTime() > Date.now()) {
      if (!invite.inviteeGithubLogin || invite.inviteeGithubLogin === user.githubLogin) {
        await db.addWorkspaceMember({
          workspaceId: invite.workspaceId,
          userId: user.id,
          githubUserId: user.githubUserId,
          githubLogin: user.githubLogin,
          role: invite.role,
          status: 'active',
          invitedByUserId: invite.invitedByUserId
        });
        await db.consumeWorkspaceInvite(invite.id, user.id);
      }
    }
  }

  const { sessionToken } = await createSessionTokenRecord(
    c.env,
    user,
    c.req.header('cf-connecting-ip') || undefined,
    c.req.header('user-agent') || undefined
  );

  const cookieDomain = c.env.SESSION_COOKIE_DOMAIN?.trim() || undefined;
  setCookie(c, getSessionCookieName(c.env), sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
    maxAge: getSessionTtlHours(c.env) * 3600
  });

  const appBaseUrl = c.env.APP_BASE_URL?.trim();
  const redirectTarget = parsedState.redirectTo || '/onboarding';
  const redirectUrl = appBaseUrl
    ? new URL(redirectTarget, appBaseUrl).toString()
    : new URL(redirectTarget, c.req.url).toString();

  return c.redirect(redirectUrl, 302);
});

app.get('/v1/auth/session', async c => {
  const resolved = await resolveSession(c);
  if (!resolved) {
    return jsonResponse({
      authenticated: false,
      workspaces: []
    });
  }

  const workspaces = await db.listWorkspacesForUser(resolved.user.id);
  const workspaceMemberships = await Promise.all(
    workspaces.map(async workspace => {
      const member = await db.getWorkspaceMember(workspace.id, resolved.user.id);
      if (!member) {
        return null;
      }

      return {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        role: member.role
      };
    })
  );

  return jsonResponse({
    authenticated: true,
    user: {
      id: resolved.user.id,
      githubUserId: resolved.user.githubUserId,
      githubLogin: resolved.user.githubLogin,
      displayName: resolved.user.displayName,
      avatarUrl: resolved.user.avatarUrl
    },
    workspaces: workspaceMemberships.filter(
      (membership): membership is NonNullable<(typeof workspaceMemberships)[number]> => Boolean(membership)
    )
  });
});

app.post('/v1/auth/logout', async c => {
  const cookieName = getSessionCookieName(c.env);
  const sessionToken = getCookie(c, cookieName);
  if (sessionToken) {
    const sessionTokenHash = await sha256Hex(`${getSessionSecret(c.env)}:${sessionToken}`);
    const session = await db.getSessionByTokenHash(sessionTokenHash);
    if (session) {
      await db.revokeSession(session.id);
    }
  }

  deleteCookie(c, cookieName, {
    path: '/'
  });

  return jsonResponse({
    ok: true
  });
});

app.get('/v1/workspaces', async c => {
  const auth = await requireSession(c);
  if (auth instanceof Response) {
    return auth;
  }

  const workspaces = await db.listWorkspacesForUser(auth.user.id);
  const items = await Promise.all(
    workspaces.map(async workspace => {
      const member = await db.getWorkspaceMember(workspace.id, auth.user.id);
      return {
        ...workspace,
        role: member?.role || 'viewer'
      };
    })
  );

  return jsonResponse({
    workspaces: items
  });
});

app.post('/v1/workspaces', async c => {
  const auth = await requireSession(c);
  if (auth instanceof Response) {
    return auth;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  if (!isObject(payload)) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: 'Body must be a JSON object.'
      },
      400
    );
  }

  const request: CreateWorkspaceRequest = {
    slug: typeof payload.slug === 'string' ? normalizeSlug(payload.slug) : '',
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
    kind: payload.kind === 'personal' ? 'personal' : 'organization',
    githubAccountType: payload.githubAccountType === 'user' ? 'user' : payload.githubAccountType === 'organization' ? 'organization' : undefined,
    githubAccountId: typeof payload.githubAccountId === 'string' ? payload.githubAccountId.trim() : undefined
  };

  if (!request.slug || !request.name) {
    return jsonResponse(
      {
        error: 'invalid_workspace_payload',
        message: 'slug and name are required.'
      },
      400
    );
  }

  try {
    const workspace = await db.createWorkspace({
      slug: request.slug,
      name: request.name,
      kind: request.kind,
      githubAccountType: request.githubAccountType,
      githubAccountId: request.githubAccountId,
      createdByUserId: auth.user.id
    });

    await db.addWorkspaceMember({
      workspaceId: workspace.id,
      userId: auth.user.id,
      githubUserId: auth.user.githubUserId,
      githubLogin: auth.user.githubLogin,
      role: 'owner',
      status: 'active'
    });

    await db.upsertWorkspaceRuleDefaults(defaultWorkspaceRuleDefaults(workspace.id, auth.user.id));

    await db.appendAuditLog({
      workspaceId: workspace.id,
      actorUserId: auth.user.id,
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: workspace.id,
      metadata: {
        slug: workspace.slug,
        name: workspace.name
      },
      requestId: c.get('requestId')
    });

    return jsonResponse({ workspace }, 201);
  } catch (error) {
    return jsonResponse(
      {
        error: 'workspace_create_failed',
        message: error instanceof Error ? error.message : 'Workspace create failed.'
      },
      409
    );
  }
});

app.get('/v1/workspaces/:workspaceId', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  return jsonResponse({
    workspace: access.workspace,
    role: access.member.role
  });
});

app.get('/v1/workspaces/:workspaceId/members', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  const members = await db.listWorkspaceMembers(workspaceId);
  return jsonResponse({ members });
});

app.post('/v1/workspaces/:workspaceId/invites', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  if (!isObject(payload)) {
    return jsonResponse(
      {
        error: 'invalid_invite_payload',
        message: 'Body must be a JSON object.'
      },
      400
    );
  }

  const request: CreateInviteRequest = {
    role:
      payload.role === 'owner' ||
      payload.role === 'admin' ||
      payload.role === 'member' ||
      payload.role === 'viewer'
        ? payload.role
        : 'member',
    inviteeGithubLogin:
      typeof payload.inviteeGithubLogin === 'string' && payload.inviteeGithubLogin.trim()
        ? payload.inviteeGithubLogin.trim()
        : undefined,
    inviteeEmail:
      typeof payload.inviteeEmail === 'string' && payload.inviteeEmail.trim()
        ? payload.inviteeEmail.trim()
        : undefined,
    expiresInHours:
      typeof payload.expiresInHours === 'number' && Number.isInteger(payload.expiresInHours)
        ? Math.max(1, Math.min(24 * 30, payload.expiresInHours))
        : 72
  };

  const inviteToken = await randomToken(24);
  const inviteTokenHash = await sha256Hex(`${getSessionSecret(c.env)}:${inviteToken}`);
  const expiresInHours = request.expiresInHours ?? 72;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600_000).toISOString();

  const invite = await db.createWorkspaceInvite({
    workspaceId,
    inviteTokenHash,
    inviteeGithubLogin: request.inviteeGithubLogin,
    inviteeEmail: request.inviteeEmail,
    role: request.role,
    invitedByUserId: access.member.userId,
    expiresAt
  });

  await db.appendAuditLog({
    workspaceId,
    actorUserId: access.member.userId,
    action: 'workspace.invite.created',
    resourceType: 'workspace_invite',
    resourceId: invite.id,
    metadata: {
      role: invite.role,
      inviteeGithubLogin: invite.inviteeGithubLogin,
      inviteeEmail: invite.inviteeEmail
    },
    requestId: c.get('requestId')
  });

  return jsonResponse(
    {
      invite,
      inviteToken
    },
    201
  );
});

app.patch('/v1/workspaces/:workspaceId/members/:memberId', async c => {
  const workspaceId = c.req.param('workspaceId');
  const memberId = c.req.param('memberId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  if (!isObject(payload)) {
    return jsonResponse(
      {
        error: 'invalid_member_patch',
        message: 'Body must be a JSON object.'
      },
      400
    );
  }

  const request: UpdateWorkspaceMemberRequest = {
    role:
      payload.role === 'owner' ||
      payload.role === 'admin' ||
      payload.role === 'member' ||
      payload.role === 'viewer'
        ? payload.role
        : undefined,
    status:
      payload.status === 'active' ||
      payload.status === 'invited' ||
      payload.status === 'suspended' ||
      payload.status === 'removed'
        ? payload.status
        : undefined
  };

  if (!request.role && !request.status) {
    return jsonResponse(
      {
        error: 'invalid_member_patch',
        message: 'role or status is required.'
      },
      400
    );
  }

  const updated = await db.updateWorkspaceMember(workspaceId, memberId, {
    role: request.role,
    status: request.status
  });

  if (!updated) {
    return jsonResponse(
      {
        error: 'member_not_found',
        message: `Member ${memberId} not found in workspace ${workspaceId}.`
      },
      404
    );
  }

  await db.appendAuditLog({
    workspaceId,
    actorUserId: access.member.userId,
    action: 'workspace.member.updated',
    resourceType: 'workspace_member',
    resourceId: updated.id,
    metadata: {
      role: updated.role,
      status: updated.status
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({ member: updated });
});

app.get('/v1/workspaces/:workspaceId/github/installations', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const installations = await db.listGitHubInstallations(workspaceId);
  return jsonResponse({ installations });
});

app.post('/v1/workspaces/:workspaceId/github/sync', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  if (!isObject(payload)) {
    return jsonResponse(
      {
        error: 'invalid_sync_payload',
        message: 'Body must be a JSON object.'
      },
      400
    );
  }

  const installationId = typeof payload.installationId === 'string' ? payload.installationId.trim() : '';
  const accountType = payload.accountType === 'user' ? 'user' : 'organization';
  const accountId = typeof payload.accountId === 'string' ? payload.accountId.trim() : '';
  const accountLogin = typeof payload.accountLogin === 'string' ? payload.accountLogin.trim() : undefined;

  if (!installationId || !accountId) {
    return jsonResponse(
      {
        error: 'invalid_sync_payload',
        message: 'installationId and accountId are required.'
      },
      400
    );
  }

  await db.upsertGitHubInstallation({
    workspaceId,
    installationId,
    accountType,
    accountId,
    accountLogin
  });

  let repositories: SyncRepositoryInput[] = [];
  if (Array.isArray(payload.repositories)) {
    repositories = payload.repositories
      .filter(isObject)
      .map(value => ({
        id: typeof value.id === 'string' ? value.id : undefined,
        owner: typeof value.owner === 'string' ? value.owner.trim() : '',
        name: typeof value.name === 'string' ? value.name.trim() : '',
        fullName: typeof value.fullName === 'string' ? value.fullName.trim() : undefined,
        defaultBranch: typeof value.defaultBranch === 'string' ? value.defaultBranch.trim() : undefined,
        isPrivate: typeof value.isPrivate === 'boolean' ? value.isPrivate : undefined
      }))
      .filter(repository => repository.owner && repository.name);
  }

  if (repositories.length === 0 && c.env.GITHUB_SYNC_TOKEN?.trim()) {
    try {
      repositories = await githubListCurrentInstallationRepositories(c.env.GITHUB_SYNC_TOKEN.trim());
    } catch (error) {
      return jsonResponse(
        {
          error: 'github_sync_failed',
          message: error instanceof Error ? error.message : 'Unable to sync GitHub installation repositories.'
        },
        502
      );
    }
  }

  if (repositories.length === 0) {
    return jsonResponse(
      {
        error: 'repositories_required',
        message: 'No repositories provided and no GITHUB_SYNC_TOKEN configured.'
      },
      400
    );
  }

  const synced: RepositoryConnection[] = [];
  for (const repository of repositories) {
    const fullName = repository.fullName || `${repository.owner}/${repository.name}`;
    const record = await db.upsertRepository({
      workspaceId,
      provider: 'github',
      owner: repository.owner,
      name: repository.name,
      fullName,
      githubRepoId: repository.id,
      installationId,
      defaultBranch: repository.defaultBranch || 'main',
      isPrivate: repository.isPrivate,
      isActive: true
    });
    synced.push(record);
  }

  await db.appendAuditLog({
    workspaceId,
    actorUserId: access.member.userId,
    action: 'github.installation.synced',
    resourceType: 'github_installation',
    resourceId: installationId,
    metadata: {
      syncedCount: synced.length,
      accountType,
      accountId
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({
    installationId,
    syncedCount: synced.length,
    repositories: synced
  });
});

app.get('/v1/workspaces/:workspaceId/repositories', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const repositories = await db.listRepositories(workspaceId);
  return jsonResponse({ repositories });
});

app.post('/v1/workspaces/:workspaceId/repositories/:repositoryId/indexing/trigger', async c => {
  const workspaceId = c.req.param('workspaceId');
  const repositoryId = c.req.param('repositoryId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  const repository = await db.getRepositoryById(repositoryId);
  if (!repository || repository.workspaceId !== workspaceId) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${repositoryId}`
      },
      404
    );
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch {
    payload = undefined;
  }

  const sourceRef = isObject(payload) && typeof payload.sourceRef === 'string' && payload.sourceRef.trim()
    ? payload.sourceRef.trim()
    : repository.defaultBranch || 'main';

  const run = await db.createIndexingRun({
    repositoryId,
    status: 'queued',
    sourceRef,
    startedAt: nowIso()
  });

  await db.appendAuditLog({
    workspaceId,
    actorUserId: access.member.userId,
    action: 'indexing.triggered',
    resourceType: 'indexing_run',
    resourceId: run.id,
    metadata: {
      repositoryId,
      sourceRef
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({ run }, 202);
});

app.get('/v1/workspaces/:workspaceId/repositories/:repositoryId/indexing/stats', async c => {
  const workspaceId = c.req.param('workspaceId');
  const repositoryId = c.req.param('repositoryId');
  const access = await requireWorkspaceMember(c, workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const stats = await db.getIndexingStats(repositoryId);
  return jsonResponse({ stats });
});

app.get('/v1/workspaces/:workspaceId/rules/default', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const config = (await db.getWorkspaceRuleDefaults(workspaceId)) || defaultWorkspaceRuleDefaults(workspaceId);
  return jsonResponse({ config });
});

app.put('/v1/workspaces/:workspaceId/rules/default', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  const fallback = (await db.getWorkspaceRuleDefaults(workspaceId)) || defaultWorkspaceRuleDefaults(workspaceId, access.member.userId);
  const parsed = parseRuleInput(payload, fallback);

  const config = await db.upsertWorkspaceRuleDefaults({
    workspaceId,
    schemaVersion: 1,
    failOnFindings: parsed.failOnFindings,
    failOnSeverity: parsed.failOnSeverity,
    maxInlineFindings: parsed.maxInlineFindings,
    minInlineSeverity: parsed.minInlineSeverity,
    reviewTone: parsed.reviewTone,
    blockedPatterns: parsed.blockedPatterns,
    requiredChecks: parsed.requiredChecks,
    severityThresholds: parsed.severityThresholds,
    updatedByUserId: access.member.userId,
    updatedAt: nowIso()
  });

  await db.appendAuditLog({
    workspaceId,
    actorUserId: access.member.userId,
    action: 'rules.workspace_default.updated',
    resourceType: 'workspace_rule_defaults',
    resourceId: workspaceId,
    metadata: {
      schemaVersion: 1
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({ config });
});

app.get('/v1/repositories/:repositoryId/rules', async c => {
  const repositoryId = c.req.param('repositoryId');
  const repository = await db.getRepositoryById(repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const override = await db.getRepositoryRuleOverride(repositoryId);
  return jsonResponse({
    config: override || null
  });
});

app.put('/v1/repositories/:repositoryId/rules', async c => {
  const repositoryId = c.req.param('repositoryId');
  const repository = await db.getRepositoryById(repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  const workspaceDefaults =
    (await db.getWorkspaceRuleDefaults(repository.workspaceId)) || defaultWorkspaceRuleDefaults(repository.workspaceId);
  const fallback: RepositoryRuleConfig = {
    ...toRepositoryRuleConfig(workspaceDefaults, repositoryId),
    repositoryId,
    updatedAt: nowIso()
  };
  const parsed = parseRuleInput(payload, fallback, repositoryId);

  const config = await db.upsertRepositoryRuleOverride({
    repositoryId,
    schemaVersion: 1,
    failOnFindings: parsed.failOnFindings,
    failOnSeverity: parsed.failOnSeverity,
    maxInlineFindings: parsed.maxInlineFindings,
    minInlineSeverity: parsed.minInlineSeverity,
    reviewTone: parsed.reviewTone,
    blockedPatterns: parsed.blockedPatterns,
    requiredChecks: parsed.requiredChecks,
    severityThresholds: parsed.severityThresholds,
    updatedByUserId: access.member.userId,
    updatedAt: nowIso()
  });

  await db.appendAuditLog({
    workspaceId: repository.workspaceId,
    actorUserId: access.member.userId,
    action: 'rules.repository_override.updated',
    resourceType: 'repository_rule_override',
    resourceId: repositoryId,
    metadata: {
      repositoryId
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({ config });
});

app.get('/v1/repositories/:repositoryId/rules/effective', async c => {
  const repositoryId = c.req.param('repositoryId');
  const repository = await db.getRepositoryById(repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const workspaceDefaults =
    (await db.getWorkspaceRuleDefaults(repository.workspaceId)) || defaultWorkspaceRuleDefaults(repository.workspaceId);
  const override = await db.getRepositoryRuleOverride(repositoryId);

  const effective = override
    ? {
        repositoryId,
        failOnFindings: override.failOnFindings,
        failOnSeverity: override.failOnSeverity,
        maxInlineFindings: override.maxInlineFindings,
        minInlineSeverity: override.minInlineSeverity,
        reviewTone: override.reviewTone,
        blockedPatterns: override.blockedPatterns,
        requiredChecks: override.requiredChecks,
        severityThresholds: override.severityThresholds,
        updatedAt: override.updatedAt
      }
    : {
        repositoryId,
        failOnFindings: workspaceDefaults.failOnFindings,
        failOnSeverity: workspaceDefaults.failOnSeverity,
        maxInlineFindings: workspaceDefaults.maxInlineFindings,
        minInlineSeverity: workspaceDefaults.minInlineSeverity,
        reviewTone: workspaceDefaults.reviewTone,
        blockedPatterns: workspaceDefaults.blockedPatterns,
        requiredChecks: workspaceDefaults.requiredChecks,
        severityThresholds: workspaceDefaults.severityThresholds,
        updatedAt: workspaceDefaults.updatedAt
      };

  return jsonResponse({
    workspaceDefaults,
    repositoryOverride: override || null,
    effective
  });
});

app.get('/v1/repositories/:repositoryId/pull-requests', async c => {
  const repositoryId = c.req.param('repositoryId');
  const repository = await db.getRepositoryById(repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const pullRequests = await db.listPullRequestsByRepository(repositoryId);
  return jsonResponse({ pullRequests });
});

app.get('/v1/pull-requests/:pullRequestId/reviews', async c => {
  const pullRequestId = c.req.param('pullRequestId');
  const pullRequest = await db.getPullRequestById(pullRequestId);
  if (!pullRequest) {
    return jsonResponse(
      {
        error: 'pull_request_not_found',
        message: `Unknown pull request: ${pullRequestId}`
      },
      404
    );
  }

  const repository = await db.getRepositoryById(pullRequest.repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${pullRequest.repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const runs = await db.listReviewRunsByPullRequest(pullRequestId);
  return jsonResponse({ runs });
});

app.post('/v1/pull-requests/:pullRequestId/reviews/trigger', async c => {
  const pullRequestId = c.req.param('pullRequestId');
  const pullRequest = await db.getPullRequestById(pullRequestId);
  if (!pullRequest) {
    return jsonResponse(
      {
        error: 'pull_request_not_found',
        message: `Unknown pull request: ${pullRequestId}`
      },
      404
    );
  }

  const repository = await db.getRepositoryById(pullRequest.repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${pullRequest.repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['member']);
  if (access instanceof Response) {
    return access;
  }

  const run = await db.createReviewRun({
    repositoryId: repository.id,
    pullRequestId: pullRequest.id,
    prNumber: pullRequest.prNumber,
    headSha: pullRequest.headSha || `manual-${Date.now()}`,
    triggerSource: 'manual',
    status: 'queued',
    scoreVersion: ACTION_SCORE_VERSION,
    startedAt: nowIso()
  });

  await db.appendAuditLog({
    workspaceId: repository.workspaceId,
    actorUserId: access.member.userId,
    action: 'review.triggered',
    resourceType: 'review_run',
    resourceId: run.id,
    metadata: {
      pullRequestId,
      repositoryId: repository.id
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({ run }, 202);
});

app.get('/v1/review-runs/:reviewRunId/findings', async c => {
  const reviewRunId = c.req.param('reviewRunId');
  const run = await db.getReviewRunById(reviewRunId);
  if (!run) {
    return jsonResponse(
      {
        error: 'review_run_not_found',
        message: `Unknown review run: ${reviewRunId}`
      },
      404
    );
  }

  const repository = await db.getRepositoryById(run.repositoryId);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_found',
        message: `Unknown repository: ${run.repositoryId}`
      },
      404
    );
  }

  const access = await requireWorkspaceMember(c, repository.workspaceId, ['viewer']);
  if (access instanceof Response) {
    return access;
  }

  const findings = await db.listReviewFindingsByRun(reviewRunId);
  return jsonResponse({ findings });
});

app.get('/v1/workspaces/:workspaceId/audit', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw) || 100)) : 100;
  const events = await db.listAuditLogs(workspaceId, limit);
  return jsonResponse({ events });
});

app.put('/v1/workspaces/:workspaceId/secrets/gateway', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  if (!isObject(payload) || typeof payload.apiKey !== 'string' || !payload.apiKey.trim()) {
    return jsonResponse(
      {
        error: 'invalid_secret_payload',
        message: 'apiKey is required.'
      },
      400
    );
  }

  const encryptedValue = await encryptSecret(c.env, payload.apiKey.trim());
  const secret = await db.upsertWorkspaceSecret({
    workspaceId,
    kind: 'gateway_api_key',
    keyId: typeof payload.keyId === 'string' ? payload.keyId : undefined,
    encryptedValue,
    createdByUserId: access.member.userId
  });

  await db.appendAuditLog({
    workspaceId,
    actorUserId: access.member.userId,
    action: 'workspace.secret.upserted',
    resourceType: 'workspace_secret',
    resourceId: secret.id,
    metadata: {
      kind: secret.kind,
      keyId: secret.keyId
    },
    requestId: c.get('requestId')
  });

  return jsonResponse({
    secret: {
      id: secret.id,
      workspaceId: secret.workspaceId,
      kind: secret.kind,
      keyId: secret.keyId,
      updatedAt: secret.updatedAt
    }
  });
});

app.get('/v1/workspaces/:workspaceId/secrets/gateway', async c => {
  const workspaceId = c.req.param('workspaceId');
  const access = await requireWorkspaceMember(c, workspaceId, ['admin']);
  if (access instanceof Response) {
    return access;
  }

  const secret = await db.getWorkspaceSecret(workspaceId, 'gateway_api_key');
  return jsonResponse({
    configured: Boolean(secret),
    secret: secret
      ? {
          id: secret.id,
          workspaceId: secret.workspaceId,
          kind: secret.kind,
          keyId: secret.keyId,
          updatedAt: secret.updatedAt
        }
      : null
  });
});

app.post('/v1/webhooks/github', async c => {
  const deliveryId = c.req.header('x-github-delivery');
  const eventName = c.req.header('x-github-event');
  const signatureHeader = c.req.header('x-hub-signature-256');

  if (!deliveryId || !eventName) {
    return jsonResponse(
      {
        error: 'invalid_webhook_headers',
        message: 'x-github-delivery and x-github-event are required.'
      },
      400
    );
  }

  const duplicate = await db.getWebhookEventByDeliveryId('github', deliveryId);
  if (duplicate) {
    return jsonResponse(
      {
        accepted: true,
        duplicate: true,
        deliveryId,
        event: eventName
      },
      202
    );
  }

  const rawBody = await c.req.text();
  const signatureValid = await verifyGitHubWebhookSignature(c.env, rawBody, signatureHeader);

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return jsonResponse(
      {
        error: 'invalid_webhook_body',
        message: 'Webhook body must be valid JSON.'
      },
      400
    );
  }

  const envelope: GitHubWebhookEnvelope = {
    event: eventName,
    deliveryId,
    signature256: signatureHeader,
    signatureValid,
    payload,
    processingStatus: signatureValid ? 'received' : 'failed',
    receivedAt: nowIso()
  };

  await db.recordWebhookEvent(envelope);

  if (!signatureValid) {
    await db.updateWebhookEvent('github', deliveryId, {
      processingStatus: 'failed',
      processedAt: nowIso(),
      signatureValid: false
    });

    return jsonResponse(
      {
        error: 'invalid_webhook_signature',
        message: 'Webhook signature could not be verified.'
      },
      401
    );
  }

  let processingStatus: GitHubWebhookEnvelope['processingStatus'] = 'processed';
  let createdReviewRunId: string | null = null;
  let reviewTier: WorkspaceTier = 'free';

  if (eventName === 'installation' && isObject(payload)) {
    // Auto-provision free workspace when GitHub App is installed
    const action = typeof payload.action === 'string' ? payload.action : '';
    if (action === 'created') {
      const installation = isObject(payload.installation) ? payload.installation : null;
      const installationId = installation && typeof installation.id === 'number' ? String(installation.id) : null;
      const account = installation && isObject(installation.account) ? installation.account : null;
      const accountLogin = account && typeof account.login === 'string' ? account.login : null;
      const accountId = account && typeof account.id === 'number' ? String(account.id) : null;
      const accountType = account && typeof account.type === 'string'
        ? (account.type.toLowerCase() === 'organization' ? 'organization' : 'user') as const
        : 'user' as const;

      if (installationId && accountLogin && accountId) {
        // Check if a workspace already exists for this GitHub account
        const allWorkspaces = await db.listAllWorkspaces();
        const existingWorkspace = allWorkspaces.find(ws => ws.githubAccountId === accountId);

        if (!existingWorkspace) {
          const slug = `oss-${accountLogin.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
          const workspace = await db.createWorkspace({
            slug,
            name: accountLogin,
            kind: 'oss_free',
            githubAccountType: accountType,
            githubAccountId: accountId,
            createdByUserId: 'system'
          });

          await db.upsertGitHubInstallation({
            workspaceId: workspace.id,
            installationId,
            accountType,
            accountId,
            accountLogin
          });

          // Sync repositories from the installation payload
          const repos = Array.isArray(payload.repositories) ? payload.repositories : [];
          for (const repo of repos) {
            if (!isObject(repo)) continue;
            const repoName = typeof repo.name === 'string' ? repo.name : '';
            const repoFullName = typeof repo.full_name === 'string' ? repo.full_name : '';
            const repoPrivate = typeof repo.private === 'boolean' ? repo.private : false;
            const repoId = typeof repo.id === 'number' ? String(repo.id) : undefined;

            if (repoName && repoFullName) {
              await db.upsertRepository({
                workspaceId: workspace.id,
                provider: 'github',
                owner: accountLogin,
                name: repoName,
                fullName: repoFullName,
                githubRepoId: repoId,
                installationId,
                isPrivate: repoPrivate,
                isActive: true
              });
            }
          }

          console.log(`[webhook] auto-provisioned oss_free workspace=${workspace.id} for ${accountLogin}`);
        }
      }
    }
  } else if (eventName === 'pull_request' && isObject(payload)) {
    const repositoryRef = parseGitHubRepositoryReference(payload);
    const pullRequestPayload = parsePullRequestPayload(payload);

    if (repositoryRef && pullRequestPayload) {
      const repositories = await getAllRepositories();
      const repository = repositories.find(item => item.fullName === repositoryRef.fullName);
      if (repository) {
        // Resolve workspace tier for this repository
        const workspace = await db.getWorkspaceForRepository(repository.id);
        reviewTier = workspace?.tier || 'free';

        // Visibility gate: private repo on free tier — skip review
        if (repository.isPrivate && reviewTier === 'free') {
          processingStatus = 'ignored';
          console.log(`[webhook] skipped private repo ${repository.fullName} on free tier`);
        } else {
          // Detect agent-authored PRs
          const prBodyRaw = isObject(payload.pull_request) && typeof (payload.pull_request as Record<string, unknown>).body === 'string'
            ? (payload.pull_request as Record<string, unknown>).body as string
            : undefined;
          const agentResult = detectAgent({
            authorLogin: pullRequestPayload.authorGithubLogin,
            prBody: prBodyRaw,
            headRef: pullRequestPayload.headRef,
          });

          const pullRequest = await db.upsertPullRequest({
            repositoryId: repository.id,
            githubPrId: pullRequestPayload.githubPrId,
            prNumber: pullRequestPayload.prNumber,
            title: pullRequestPayload.title,
            authorGithubLogin: pullRequestPayload.authorGithubLogin,
            baseRef: pullRequestPayload.baseRef,
            headRef: pullRequestPayload.headRef,
            headSha: pullRequestPayload.headSha,
            state: pullRequestPayload.state,
            isAgentAuthored: agentResult.isAgentAuthored,
            agentName: agentResult.agentName,
            mergedAt: pullRequestPayload.state === 'merged' ? nowIso() : undefined,
            closedAt: pullRequestPayload.state === 'closed' ? nowIso() : undefined
          });

          const action = typeof payload.action === 'string' ? payload.action : '';
          if (actionCanTriggerReview(action)) {
            // Rate limit: check monthly usage for free tier
            if (reviewTier === 'free') {
              const period = currentPeriod();
              const usage = await db.getRepositoryUsage(repository.id, period);
              if (usage && usage.reviewCount >= FREE_TIER_PR_LIMIT) {
                processingStatus = 'ignored';
                console.log(`[webhook] rate limited ${repository.fullName}: ${usage.reviewCount}/${FREE_TIER_PR_LIMIT} reviews in ${period}`);
              }
            }

            if (processingStatus !== 'ignored') {
              const reviewMode = pullRequest.isAgentAuthored ? 'agent' : 'standard';

              // On synchronize (push), link to previous completed review run
              let parentReviewRunId: string | undefined;
              if (action === 'synchronize' && pullRequest.id) {
                const latestRun = await db.getLatestCompletedReviewRun(pullRequest.id);
                if (latestRun) {
                  parentReviewRunId = latestRun.id;
                }
              }

              // Increment usage counter for free tier
              if (reviewTier === 'free') {
                await db.incrementRepositoryUsage(repository.id, currentPeriod());
              }

              const reviewRun = await db.createReviewRun({
                repositoryId: repository.id,
                pullRequestId: pullRequest.id,
                prNumber: pullRequest.prNumber,
                headSha: pullRequest.headSha || `webhook-${Date.now()}`,
                triggerSource: 'webhook',
                status: 'queued',
                reviewMode,
                parentReviewRunId,
                scoreVersion: ACTION_SCORE_VERSION,
                startedAt: nowIso()
              });
              createdReviewRunId = reviewRun.id;
            }
          }
        }
      } else {
        processingStatus = 'ignored';
      }
    } else {
      processingStatus = 'ignored';
    }
  } else if (eventName === 'issue_comment' && isObject(payload)) {
    // Handle @codevetter mention in PR comments
    const action = typeof payload.action === 'string' ? payload.action : '';
    const comment = isObject(payload.comment) ? payload.comment : null;
    const issue = isObject(payload.issue) ? payload.issue : null;
    const commentBody = comment && typeof comment.body === 'string' ? comment.body : '';
    const isPr = issue && isObject(issue.pull_request);

    if (action === 'created' && isPr && /\b@codevetter\b/i.test(commentBody)) {
      const repositoryRef = parseGitHubRepositoryReference(payload);
      const prNumber = issue && typeof issue.number === 'number' ? issue.number : null;

      if (repositoryRef && prNumber) {
        const repositories = await getAllRepositories();
        const repository = repositories.find(item => item.fullName === repositoryRef.fullName);
        if (repository) {
          // Resolve workspace tier
          const workspace = await db.getWorkspaceForRepository(repository.id);
          reviewTier = workspace?.tier || 'free';

          // Visibility gate: private repo on free tier
          if (repository.isPrivate && reviewTier === 'free') {
            processingStatus = 'ignored';
          } else {
            // Find existing PR record
            const pullRequests = await db.listPullRequestsByRepository(repository.id);
            const pullRequest = pullRequests.find(pr => pr.prNumber === prNumber);

            if (pullRequest) {
              // Rate limit check for free tier
              let rateLimited = false;
              if (reviewTier === 'free') {
                const period = currentPeriod();
                const usage = await db.getRepositoryUsage(repository.id, period);
                if (usage && usage.reviewCount >= FREE_TIER_PR_LIMIT) {
                  rateLimited = true;
                  processingStatus = 'ignored';
                }
              }

              if (!rateLimited) {
                const reviewMode = pullRequest.isAgentAuthored ? 'agent' : 'standard';
                const latestRun = await db.getLatestCompletedReviewRun(pullRequest.id);

                if (reviewTier === 'free') {
                  await db.incrementRepositoryUsage(repository.id, currentPeriod());
                }

                const reviewRun = await db.createReviewRun({
                  repositoryId: repository.id,
                  pullRequestId: pullRequest.id,
                  prNumber: pullRequest.prNumber,
                  headSha: pullRequest.headSha || `mention-${Date.now()}`,
                  triggerSource: 'webhook',
                  status: 'queued',
                  reviewMode,
                  parentReviewRunId: latestRun?.id,
                  scoreVersion: ACTION_SCORE_VERSION,
                  startedAt: nowIso()
                });
                createdReviewRunId = reviewRun.id;
              }
            }
          }
        }
      }
    } else {
      processingStatus = 'ignored';
    }
  } else {
    processingStatus = 'ignored';
  }

  await db.updateWebhookEvent('github', deliveryId, {
    processingStatus,
    signatureValid: true,
    processedAt: nowIso()
  });

  return jsonResponse(
    {
      accepted: true,
      event: eventName,
      deliveryId,
      processingStatus,
      reviewRunId: createdReviewRunId,
      reviewTier
    },
    202
  );
});

app.post('/v1/actions/reviews/trigger', async c => {
  const expectedToken = c.env.PLATFORM_ACTION_TOKEN?.trim();
  if (!expectedToken) {
    return jsonResponse(
      {
        error: 'action_trigger_not_configured',
        message: 'PLATFORM_ACTION_TOKEN is not configured.'
      },
      503
    );
  }

  const bearerToken = readBearerToken(c.req.header('authorization'));
  if (!bearerToken || !equalConstantTime(bearerToken, expectedToken)) {
    return jsonResponse(
      {
        error: 'unauthorized',
        message: 'Missing or invalid action bearer token.'
      },
      401
    );
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(c);
  } catch (error) {
    return jsonResponse(
      {
        error: 'invalid_request',
        message: error instanceof Error ? error.message : 'Invalid JSON body.'
      },
      400
    );
  }

  if (!isObject(payload)) {
    return jsonResponse(
      {
        error: 'invalid_action_payload',
        message: 'Body must be a JSON object.'
      },
      400
    );
  }

  const request: CreateActionReviewTriggerRequest = {
    repositoryFullName:
      typeof payload.repositoryFullName === 'string' ? payload.repositoryFullName.trim() : '',
    prNumber: typeof payload.prNumber === 'number' ? payload.prNumber : NaN,
    headSha: typeof payload.headSha === 'string' ? payload.headSha.trim() : undefined,
    workflowRunId: typeof payload.workflowRunId === 'string' ? payload.workflowRunId.trim() : undefined
  };

  if (!request.repositoryFullName || !Number.isInteger(request.prNumber) || request.prNumber <= 0) {
    return jsonResponse(
      {
        error: 'invalid_action_payload',
        message: 'repositoryFullName and prNumber are required.'
      },
      400
    );
  }

  const repositories = await getAllRepositories();
  const repository = repositories.find(item => item.fullName === request.repositoryFullName);
  if (!repository) {
    return jsonResponse(
      {
        error: 'repository_not_registered',
        message: `Repository not registered in platform: ${request.repositoryFullName}`
      },
      404
    );
  }

  const pullRequest = await db.upsertPullRequest({
    repositoryId: repository.id,
    prNumber: request.prNumber,
    headSha: request.headSha,
    state: 'open'
  });

  const run = await db.createReviewRun({
    repositoryId: repository.id,
    pullRequestId: pullRequest.id,
    prNumber: pullRequest.prNumber,
    headSha: request.headSha || pullRequest.headSha || `action-${Date.now()}`,
    triggerSource: 'action',
    status: 'queued',
    scoreVersion: ACTION_SCORE_VERSION,
    startedAt: nowIso()
  });

  await db.appendAuditLog({
    workspaceId: repository.workspaceId,
    action: 'action.review_triggered',
    resourceType: 'review_run',
    resourceId: run.id,
    metadata: {
      repositoryId: repository.id,
      repositoryFullName: repository.fullName,
      prNumber: pullRequest.prNumber,
      workflowRunId: request.workflowRunId
    },
    requestId: c.get('requestId')
  });

  return jsonResponse(
    {
      accepted: true,
      run,
      statusUrl: `/v1/reviews/${run.id}/status`
    },
    202
  );
});

// ── Agent Status API (Phase 5) ────────────────────────────────────────────────

app.get('/v1/repos/:owner/:repo/pulls/:prNumber/review-status', async c => {
  const expectedToken = c.env.PLATFORM_ACTION_TOKEN?.trim();
  if (!expectedToken) {
    return jsonResponse({ error: 'not_configured', message: 'PLATFORM_ACTION_TOKEN is not configured.' }, 503);
  }

  const bearerToken = readBearerToken(c.req.header('authorization'));
  if (!bearerToken || !equalConstantTime(bearerToken, expectedToken)) {
    return jsonResponse({ error: 'unauthorized', message: 'Missing or invalid bearer token.' }, 401);
  }

  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const prNumberRaw = c.req.param('prNumber');
  const prNumber = Number(prNumberRaw);
  const fullName = `${owner}/${repo}`;

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return jsonResponse({ error: 'invalid_pr_number', message: 'prNumber must be a positive integer.' }, 400);
  }

  const repositories = await getAllRepositories();
  const repository = repositories.find(item => item.fullName === fullName);
  if (!repository) {
    return jsonResponse({ error: 'repository_not_found', message: `Repository ${fullName} not registered.` }, 404);
  }

  const pullRequests = await db.listPullRequestsByRepository(repository.id);
  const pullRequest = pullRequests.find(pr => pr.prNumber === prNumber);
  if (!pullRequest) {
    return jsonResponse({ error: 'pull_request_not_found', message: `PR #${prNumber} not found.` }, 404);
  }

  const runs = await db.listReviewRunsByPullRequest(pullRequest.id);
  const latestRun = runs.length > 0 ? runs[0] : null;

  if (!latestRun) {
    return jsonResponse({ status: 'no_reviews', prNumber, repository: fullName });
  }

  const findingsCount = latestRun.findingsCount ?? 0;
  return jsonResponse({
    reviewRunId: latestRun.id,
    status: latestRun.status,
    score: latestRun.scoreComposite,
    action: latestRun.reviewAction,
    reviewMode: latestRun.reviewMode,
    findingsCount,
    prNumber,
    repository: fullName,
    isAgentAuthored: pullRequest.isAgentAuthored,
    agentName: pullRequest.agentName,
    completedAt: latestRun.completedAt,
  });
});

app.get('/v1/reviews/:reviewRunId/status', async c => {
  const expectedToken = c.env.PLATFORM_ACTION_TOKEN?.trim();
  if (!expectedToken) {
    return jsonResponse({ error: 'not_configured', message: 'PLATFORM_ACTION_TOKEN is not configured.' }, 503);
  }

  const bearerToken = readBearerToken(c.req.header('authorization'));
  if (!bearerToken || !equalConstantTime(bearerToken, expectedToken)) {
    return jsonResponse({ error: 'unauthorized', message: 'Missing or invalid bearer token.' }, 401);
  }

  const reviewRunId = c.req.param('reviewRunId');
  const run = await db.getReviewRunById(reviewRunId);
  if (!run) {
    return jsonResponse({ error: 'review_not_found', message: `Review run ${reviewRunId} not found.` }, 404);
  }

  const findings = await db.listReviewFindingsByRun(reviewRunId);

  return jsonResponse({
    reviewRunId: run.id,
    status: run.status,
    score: run.scoreComposite,
    action: run.reviewAction,
    reviewMode: run.reviewMode,
    parentReviewRunId: run.parentReviewRunId,
    findingsCount: run.findingsCount,
    completedAt: run.completedAt,
    findings: findings.map(f => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      summary: f.summary,
      suggestion: f.suggestion,
      filePath: f.filePath,
      line: f.line,
      status: f.status,
      findingFingerprint: f.findingFingerprint,
    })),
  });
});

app.all('*', async c => {
  return jsonResponse(
    {
      error: 'not_found',
      message: `No route matches ${c.req.method} ${new URL(c.req.url).pathname}`
    },
    404
  );
});

export default app;
