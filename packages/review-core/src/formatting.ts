import { ReviewAction, ReviewFindingRecord, WorkspaceTier } from '@code-reviewer/shared-types';
import { computeFindingFingerprint } from './scoring';

type StructuredReviewData = {
  version: string;
  reviewRunId: string;
  score: number;
  action: ReviewAction;
  findings: Array<{
    severity: string;
    title: string;
    filePath?: string;
    line?: number;
    fingerprint: string;
  }>;
};

/** Build the overall GitHub PR comment body with score, findings summary, and embedded structured data */
export function buildOverallBody(
  findings: Array<{
    severity: string;
    title: string;
    filePath?: string;
    line?: number;
    suggestion?: string;
  }>,
  score: number,
  reviewRunId: string | undefined,
  action: ReviewAction,
  resolvedFindings?: ReviewFindingRecord[],
  reviewTier?: WorkspaceTier
): string {
  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');

  let body = `## AI Code Review\n\n**Score:** ${score.toFixed(0)}/100 | **Findings:** ${parts || 'none'}`;

  // Show resolved findings in re-review
  if (resolvedFindings && resolvedFindings.length > 0) {
    body += `\n\n### Resolved\n`;
    for (const rf of resolvedFindings) {
      body += `- ~~[${rf.severity.toUpperCase()}] ${rf.title}~~\n`;
    }
  }

  // Footer: badge + CTA for free tier, clean for paid
  const tier = reviewTier || 'free';
  if (tier === 'free') {
    const scoreColor = score >= 80 ? 'brightgreen' : score >= 60 ? 'yellow' : 'red';
    body += `\n\n---\n`;
    body += `\n![Score](https://img.shields.io/badge/score-${score.toFixed(0)}%2F100-${scoreColor}) `;
    body += `**[Reviewed by CodeVetter](https://codevetter.com)**\n\n`;
    body += `*Free automated PR review for open source — [get CodeVetter for your repo](https://codevetter.com/install)*`;
  } else {
    body += `\n\n*Automated review by CodeVetter*`;
  }

  // Embed structured data for agents
  if (reviewRunId) {
    const structured: StructuredReviewData = {
      version: '1.0',
      reviewRunId,
      score,
      action,
      findings: findings.map((f) => ({
        severity: f.severity,
        title: f.title,
        filePath: f.filePath,
        line: f.line,
        fingerprint: computeFindingFingerprint(f),
      })),
    };
    body += `\n\n<!-- codevetter:begin\n${JSON.stringify(structured)}\ncodevetter:end -->`;
  }

  return body;
}
