import * as jwt from 'jsonwebtoken';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GitHubAppConfig = {
  appId: string;
  privateKey: string;
  apiBaseUrl?: string;
};

export type GitHubPrFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

export type ReviewComment = {
  path: string;
  line: number;
  body: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || 'https://api.github.com').replace(/\/$/, '');
}

function githubAppJwt(config: GitHubAppConfig): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - 60, exp: now + 600, iss: config.appId },
    config.privateKey,
    { algorithm: 'RS256' }
  );
}

async function githubFetch<T>(
  path: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    accept?: string;
    baseUrl?: string;
  } = {}
): Promise<T> {
  const base = normalizeBaseUrl(options.baseUrl);
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: options.accept || 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'code-reviewer/1.0',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API ${options.method || 'GET'} ${path} failed ${response.status}: ${text.slice(0, 400)}`
    );
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getInstallationToken(
  config: GitHubAppConfig,
  installationId: string
): Promise<string> {
  const appToken = githubAppJwt(config);
  const result = await githubFetch<{ token: string }>(
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    appToken,
    { method: 'POST', baseUrl: config.apiBaseUrl }
  );
  return result.token;
}

export async function getPrDiff(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  baseUrl?: string
): Promise<string> {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github.diff',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'code-reviewer/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PR diff: ${response.status}`);
  }

  return response.text();
}

export async function getPrFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  baseUrl?: string
): Promise<GitHubPrFile[]> {
  return githubFetch<GitHubPrFile[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/files?per_page=100`,
    token,
    { baseUrl }
  );
}

export async function postPrReview(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  comments: ReviewComment[],
  overallBody: string,
  baseUrl?: string
): Promise<void> {
  await githubFetch<unknown>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${prNumber}/reviews`,
    token,
    {
      method: 'POST',
      baseUrl,
      body: {
        commit_id: headSha,
        body: overallBody,
        event: 'COMMENT',
        comments: comments.map(c => ({
          path: c.path,
          line: c.line,
          body: c.body,
          side: 'RIGHT',
        })),
      },
    }
  );
}
