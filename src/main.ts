import * as core from '@actions/core';
import { AIGatewayClient } from '../packages/ai-gateway-client/src';
import {
  GatewayConfig,
  GatewayReviewFile,
  REVIEW_SEVERITIES,
  ReviewFinding,
  ReviewSeverity
} from '../packages/shared-types/src';
import {
  buildSummaryComment,
  calculateScore,
  meetsSeverityThreshold,
  normalizeFindings,
  parseDiffFiles,
  selectInlineComments
} from '../packages/review-core/src';
import { GitHubClient } from './github';

const MAX_COMMENTS_PER_REVIEW = 40;
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function parseBooleanInput(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parseIntegerInput(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseSeverityInput(inputName: string, value: string, fallback: ReviewSeverity): ReviewSeverity {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (!REVIEW_SEVERITIES.includes(normalized as ReviewSeverity)) {
    throw new Error(
      `Invalid ${inputName}: "${value}". Use one of ${REVIEW_SEVERITIES.join(', ')}.`
    );
  }

  return normalized as ReviewSeverity;
}

function resolveGatewayConfig(): GatewayConfig {
  const model = core.getInput('model') || 'gpt-4o-mini';
  const reviewTone = core.getInput('review_tone') || 'balanced';
  const aiApiKey = core.getInput('ai_api_key');

  if (!aiApiKey) {
    throw new Error('Missing AI key. Provide ai_api_key.');
  }

  const aiBaseUrlInput = core.getInput('ai_base_url');
  const baseUrl = aiBaseUrlInput.trim() || DEFAULT_OPENAI_BASE_URL;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error(
      `Invalid ai_base_url: "${baseUrl}". Provide an OpenAI-compatible URL such as https://api.openai.com/v1.`
    );
  }

  return {
    baseUrl,
    apiKey: aiApiKey,
    model,
    reviewTone
  };
}

function toGatewayFiles(files: Awaited<ReturnType<GitHubClient['getPRFiles']>>): GatewayReviewFile[] {
  return files.map(file => ({
    path: file.filename,
    patch: file.patch,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes
  }));
}

async function postInlineCommentsBestEffort(
  githubClient: GitHubClient,
  comments: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>
): Promise<number> {
  if (comments.length === 0) {
    return 0;
  }

  let posted = 0;

  for (let i = 0; i < comments.length; i += MAX_COMMENTS_PER_REVIEW) {
    const batch = comments.slice(i, i + MAX_COMMENTS_PER_REVIEW);
    const batchNumber = Math.floor(i / MAX_COMMENTS_PER_REVIEW) + 1;

    try {
      await githubClient.createReviewComments(batch);
      posted += batch.length;
      continue;
    } catch (error) {
      core.warning(`Inline comment batch ${batchNumber} failed: ${String(error)}`);
    }

    for (const comment of batch) {
      try {
        await githubClient.createReviewComments([comment]);
        posted += 1;
      } catch (error) {
        core.warning(
          `Skipping inline comment ${comment.path}:${comment.line} (${comment.side}) due to error: ${String(error)}`
        );
      }
    }
  }

  return posted;
}

function hasBlockingFindings(
  findings: ReviewFinding[],
  failOnFindings: boolean,
  failOnSeverity: ReviewSeverity
): boolean {
  if (!failOnFindings) {
    return false;
  }

  return findings.some(finding => meetsSeverityThreshold(finding.severity, failOnSeverity));
}

async function run() {
  try {
    const githubToken = core.getInput('github_token');
    if (!githubToken) {
      throw new Error('github_token is required.');
    }

    const gatewayConfig = resolveGatewayConfig();
    const maxInlineFindings = parseIntegerInput(core.getInput('max_inline_findings') || '5', 5, 0, 20);
    const minInlineSeverity = parseSeverityInput(
      'min_inline_severity',
      core.getInput('min_inline_severity') || 'medium',
      'medium'
    );
    const failOnFindings = parseBooleanInput(core.getInput('fail_on_findings') || 'false');
    const failOnSeverity = parseSeverityInput(
      'fail_on_severity',
      core.getInput('fail_on_severity') || 'high',
      'high'
    );

    const githubClient = new GitHubClient(githubToken);

    core.info('Fetching PR files...');
    const files = await githubClient.getPRFiles();
    const gatewayFiles = toGatewayFiles(files);

    core.info('Fetching PR diff...');
    const diff = await githubClient.getPRDiff();

    if (!diff.trim()) {
      await githubClient.postComment('## AI Review Lite Summary\n\nNo reviewable diff content was found in this PR.');
      core.info('No diff content found, finished early.');
      return;
    }

    const gatewayClient = new AIGatewayClient(gatewayConfig);
    core.info(`Running gateway review with model ${gatewayConfig.model}...`);

    const gatewayResponse = await gatewayClient.reviewDiff({
      diff,
      files: gatewayFiles,
      context: {
        repoFullName: process.env.GITHUB_REPOSITORY,
        reviewTone: gatewayConfig.reviewTone
      }
    });

    const findings = normalizeFindings(gatewayResponse.findings);
    const parsedDiff = parseDiffFiles(gatewayFiles);
    const score = calculateScore(gatewayFiles, findings);

    core.info(`Found ${findings.length} normalized findings.`);

    const summaryComment = buildSummaryComment(findings, score, {
      reviewTone: gatewayConfig.reviewTone
    });

    await githubClient.postComment(summaryComment);

    const inlineComments = selectInlineComments(findings, parsedDiff, {
      maxInlineFindings,
      minInlineSeverity
    });

    const postedInline = await postInlineCommentsBestEffort(githubClient, inlineComments);
    core.info(`Posted ${postedInline}/${inlineComments.length} inline findings.`);

    if (hasBlockingFindings(findings, failOnFindings, failOnSeverity)) {
      throw new Error(
        `Blocking findings detected at severity \"${failOnSeverity}\" or above. Set fail_on_findings=false to keep advisory mode.`
      );
    }

    core.info('AI Review Lite completed successfully.');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run();
