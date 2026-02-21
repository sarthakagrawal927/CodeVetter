import https from 'https';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export type GitHubClientConfig = {
  baseUrl: string;
  token: string;
  userAgent?: string;
};

export type GitHubOrganizationSnapshot = {
  repositoryCount: number;
  memberCount: number;
  installationIds: string[];
};

export type GitHubRepository = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
};

type GitHubRequestResult<T> = {
  statusCode: number;
  body: T;
};

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;

  constructor(config: GitHubClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.token = config.token;
    this.userAgent = config.userAgent || 'code-reviewer-worker-api';
  }

  async getOrganizationSnapshot(orgLogin: string): Promise<GitHubOrganizationSnapshot> {
    const [repositoryCount, memberCount, installationIds] = await Promise.all([
      this.countArrayEndpoint(`/orgs/${encodeURIComponent(orgLogin)}/repos?type=all`),
      this.countArrayEndpoint(`/orgs/${encodeURIComponent(orgLogin)}/members`),
      this.getOrganizationInstallationIds(orgLogin),
    ]);

    return {
      repositoryCount,
      memberCount,
      installationIds,
    };
  }

  async getCurrentInstallationId(): Promise<string> {
    const result = await this.requestJson<unknown>('/installation');
    if (!isObject(result.body) || typeof result.body.id !== 'number') {
      throw new GitHubApiError('Unable to resolve current installation from token.');
    }

    return String(result.body.id);
  }

  async getRepository(owner: string, name: string): Promise<GitHubRepository> {
    const result = await this.requestJson<unknown>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    );

    if (!isObject(result.body)) {
      throw new GitHubApiError('Unexpected repository payload from GitHub.');
    }

    const repoOwner = isObject(result.body.owner) && typeof result.body.owner.login === 'string'
      ? result.body.owner.login
      : owner;
    const repoName = typeof result.body.name === 'string' ? result.body.name : name;
    const fullName = typeof result.body.full_name === 'string' ? result.body.full_name : `${repoOwner}/${repoName}`;
    const defaultBranch = typeof result.body.default_branch === 'string' ? result.body.default_branch : 'main';
    const id = typeof result.body.id === 'number' ? String(result.body.id) : `${repoOwner}/${repoName}`;
    const isPrivate = typeof result.body.private === 'boolean' ? result.body.private : false;

    return {
      id,
      owner: repoOwner,
      name: repoName,
      fullName,
      defaultBranch,
      isPrivate,
    };
  }

  private async countArrayEndpoint(basePath: string): Promise<number> {
    const perPage = 100;
    let total = 0;

    for (let page = 1; page <= 1000; page += 1) {
      const separator = basePath.includes('?') ? '&' : '?';
      const path = `${basePath}${separator}per_page=${perPage}&page=${page}`;
      const result = await this.requestJson<unknown>(path);
      if (!Array.isArray(result.body)) {
        throw new GitHubApiError(`Expected array from GitHub endpoint: ${basePath}`);
      }

      total += result.body.length;
      if (result.body.length < perPage) {
        break;
      }
    }

    return total;
  }

  private async getOrganizationInstallationIds(orgLogin: string): Promise<string[]> {
    const path = `/orgs/${encodeURIComponent(orgLogin)}/installation`;
    try {
      const result = await this.requestJson<unknown>(path);
      if (!isObject(result.body) || typeof result.body.id !== 'number') {
        return [];
      }

      return [String(result.body.id)];
    } catch (error) {
      if (error instanceof GitHubApiError && (error.statusCode === 403 || error.statusCode === 404)) {
        return [];
      }

      throw error;
    }
  }

  private async requestJson<T>(path: string): Promise<GitHubRequestResult<T>> {
    const url = new URL(path, this.baseUrl);

    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.token}`,
            'User-Agent': this.userAgent,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
        response => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => {
            chunks.push(Buffer.from(chunk));
          });

          response.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            const statusCode = response.statusCode || 500;
            const text = rawBody.trim();

            let parsedBody: unknown = null;
            if (text) {
              try {
                parsedBody = JSON.parse(text);
              } catch {
                parsedBody = text;
              }
            }

            if (statusCode >= 400) {
              const errorMessage =
                isObject(parsedBody) && typeof parsedBody.message === 'string'
                  ? parsedBody.message
                  : `GitHub API request failed with status ${statusCode}.`;
              reject(new GitHubApiError(errorMessage, statusCode));
              return;
            }

            resolve({
              statusCode,
              body: parsedBody as T,
            });
          });
        }
      );

      request.on('error', error => {
        reject(new GitHubApiError(`GitHub API request error: ${error.message}`));
      });

      request.end();
    });
  }
}
