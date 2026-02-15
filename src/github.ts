import * as github from '@actions/github';

export type PRFile = {
  filename: string;
  sha: string;
  patch?: string;
};

export type ReviewCommentInput = {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
};

export class GitHubClient {
  private octokit;
  private context;

  constructor(token: string) {
    this.octokit = github.getOctokit(token);
    this.context = github.context;
  }

  private getPullRequestContext(): { owner: string; repo: string; pullNumber: number } {
    const { owner, repo, number } = this.context.issue;

    if (!number) {
      throw new Error('No PR number found in context');
    }

    return { owner, repo, pullNumber: number };
  }

  async getPRDiff(): Promise<string> {
    const { owner, repo, pullNumber } = this.getPullRequestContext();

    const response = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: {
        format: 'diff'
      }
    });

    return response.data as unknown as string;
  }

  async postComment(body: string): Promise<void> {
    const { owner, repo, pullNumber } = this.getPullRequestContext();

    await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body
    });
  }

  async getPRFiles(): Promise<PRFile[]> {
    const { owner, repo, pullNumber } = this.getPullRequestContext();

    const { data: files } = await this.octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber
    });

    return files.map(file => ({
      filename: file.filename,
      sha: file.sha,
      patch: file.patch ?? undefined
    }));
  }

  async createReviewComments(comments: ReviewCommentInput[]): Promise<void> {
    if (comments.length === 0) {
      return;
    }

    const { owner, repo, pullNumber } = this.getPullRequestContext();

    const pr = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber
    });

    await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: pr.data.head.sha,
      event: 'COMMENT',
      comments: comments.map(comment => ({
        path: comment.path,
        body: comment.body,
        line: comment.line,
        side: comment.side
      }))
    });
  }
}
