import { ReviewFinding, ReviewScore, ReviewSeverity } from '../../shared-types/src';
import { sortBySeverity } from './findings';

const ORDERED_SEVERITIES: ReviewSeverity[] = ['critical', 'high', 'medium', 'low'];

function formatFindingLine(finding: ReviewFinding): string {
  const location = finding.filePath
    ? ` (${finding.filePath}${finding.line ? `:${finding.line}` : ''})`
    : '';
  return `- **${finding.title}**${location}: ${finding.summary}`;
}

export function buildSummaryComment(
  findings: ReviewFinding[],
  score: ReviewScore,
  options: { reviewTone: string; maxFindingsPerSeverity?: number }
): string {
  const sorted = sortBySeverity(findings);
  const maxPerSeverity = options.maxFindingsPerSeverity ?? 5;

  const grouped = new Map<ReviewSeverity, ReviewFinding[]>();
  for (const severity of ORDERED_SEVERITIES) {
    grouped.set(severity, []);
  }

  for (const finding of sorted) {
    const bucket = grouped.get(finding.severity);
    if (!bucket) {
      continue;
    }

    if (bucket.length < maxPerSeverity) {
      bucket.push(finding);
    }
  }

  const sections: string[] = [];
  for (const severity of ORDERED_SEVERITIES) {
    const severityFindings = grouped.get(severity) ?? [];
    if (severityFindings.length === 0) {
      continue;
    }

    sections.push(`#### ${severity.toUpperCase()} (${severityFindings.length})`);
    sections.push(...severityFindings.map(formatFindingLine));
    sections.push('');
  }

  const body = sections.length > 0 ? sections.join('\n') : '_No significant findings from AI review._';

  return [
    '## AI Review Lite Summary',
    '',
    `Tone: \`${options.reviewTone}\``,
    '',
    '| Score | Value |',
    '| --- | --- |',
    `| Quality | **${score.quality}** |`,
    `| Risk | **${score.risk}** |`,
    `| Value | **${score.value}** |`,
    `| Composite | **${score.composite}** |`,
    '',
    body,
    '',
    `score_footer: quality=${score.quality};risk=${score.risk};value=${score.value};composite=${score.composite}`
  ].join('\n');
}

export function buildInlineFindingComment(finding: ReviewFinding, index: number, total: number): string {
  const location = finding.filePath && finding.line ? `${finding.filePath}:${finding.line}` : 'unknown location';
  return [
    `AI finding ${index}/${total}`,
    `Severity: **${finding.severity.toUpperCase()}**`,
    `Location: ${location}`,
    '',
    `**${finding.title}**`,
    finding.summary
  ].join('\n');
}
