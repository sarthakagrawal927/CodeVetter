import { REVIEW_SEVERITIES, ReviewFinding, ReviewSeverity } from '../../shared-types/src';

const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

export function parseSeverity(value: string, fallback: ReviewSeverity = 'medium'): ReviewSeverity {
  const normalized = value.trim().toLowerCase();
  return REVIEW_SEVERITIES.includes(normalized as ReviewSeverity)
    ? (normalized as ReviewSeverity)
    : fallback;
}

export function meetsSeverityThreshold(severity: ReviewSeverity, threshold: ReviewSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

export function severityWeight(severity: ReviewSeverity): number {
  switch (severity) {
    case 'critical':
      return 35;
    case 'high':
      return 20;
    case 'medium':
      return 10;
    case 'low':
      return 4;
    default:
      return 0;
  }
}

export function sortBySeverity(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    const confidenceA = typeof a.confidence === 'number' ? a.confidence : 0;
    const confidenceB = typeof b.confidence === 'number' ? b.confidence : 0;
    return confidenceB - confidenceA;
  });
}

export function normalizeFindings(rawFindings: ReviewFinding[]): ReviewFinding[] {
  const deduped = new Map<string, ReviewFinding>();

  for (const raw of rawFindings) {
    const title = raw.title.trim();
    const summary = raw.summary.trim();
    if (!title || !summary) {
      continue;
    }

    const severity = REVIEW_SEVERITIES.includes(raw.severity) ? raw.severity : 'medium';

    const finding: ReviewFinding = {
      severity,
      title,
      summary,
      filePath: raw.filePath?.trim() || undefined,
      line: typeof raw.line === 'number' && Number.isInteger(raw.line) && raw.line > 0 ? raw.line : undefined,
      confidence:
        typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
          ? Math.max(0, Math.min(1, raw.confidence))
          : undefined
    };

    const key = [
      finding.severity,
      finding.title.toLowerCase(),
      finding.summary.toLowerCase(),
      finding.filePath?.toLowerCase() ?? '',
      finding.line ?? ''
    ].join('|');

    if (!deduped.has(key)) {
      deduped.set(key, finding);
    }
  }

  return sortBySeverity(Array.from(deduped.values()));
}
