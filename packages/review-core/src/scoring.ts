import { ReviewAction, ReviewMode } from '@code-reviewer/shared-types';

/** Severity weight map for computing composite review scores */
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
};

/** Compute a composite score (0-100) from findings. 100 = no issues. */
export function computeScore(findings: Array<{ severity: string }>): number {
  if (findings.length === 0) return 100;
  const penalty = findings.reduce(
    (sum, f) => sum + (SEVERITY_WEIGHTS[f.severity] ?? 2),
    0
  );
  return Math.max(0, 100 - penalty);
}

/** Compute a stable fingerprint for a finding (for dedup across re-reviews) */
export function computeFindingFingerprint(f: {
  filePath?: string;
  severity: string;
  title: string;
}): string {
  const raw = `${f.filePath || ''}:${f.severity}:${f.title}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `fp_${(hash >>> 0).toString(36)}`;
}

/** Determine the GitHub review action based on findings, score, and review mode */
export function determineReviewAction(
  findings: Array<{ severity: string }>,
  score: number,
  reviewMode: ReviewMode
): ReviewAction {
  if (findings.length === 0) return 'APPROVE';

  const hasBlocker = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high'
  );

  if (reviewMode === 'agent') {
    if (score >= 80 && !hasBlocker) return 'APPROVE';
    return 'REQUEST_CHANGES';
  }

  // Human PRs default to COMMENT (non-blocking)
  return 'COMMENT';
}
