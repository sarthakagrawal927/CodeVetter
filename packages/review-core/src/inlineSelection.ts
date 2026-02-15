import { InlineReviewComment, ReviewFinding, ReviewSeverity } from '../../shared-types/src';
import { ParsedDiff } from './diff';
import { meetsSeverityThreshold, sortBySeverity } from './findings';
import { buildInlineFindingComment } from './comments';

export function selectInlineComments(
  findings: ReviewFinding[],
  parsedDiff: ParsedDiff,
  options: { maxInlineFindings: number; minInlineSeverity: ReviewSeverity }
): InlineReviewComment[] {
  if (options.maxInlineFindings <= 0) {
    return [];
  }

  const selected: InlineReviewComment[] = [];
  const seen = new Set<string>();

  const eligible = sortBySeverity(
    findings.filter(
      finding =>
        !!finding.filePath &&
        !!finding.line &&
        meetsSeverityThreshold(finding.severity, options.minInlineSeverity)
    )
  );

  for (const finding of eligible) {
    if (selected.length >= options.maxInlineFindings) {
      break;
    }

    const path = finding.filePath;
    const line = finding.line;
    if (!path || !line) {
      continue;
    }

    const side = parsedDiff.lineSideIndex.get(path)?.get(line) ?? 'RIGHT';
    const key = `${path}:${line}:${side}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    selected.push({
      path,
      line,
      side,
      body: buildInlineFindingComment(finding, selected.length + 1, options.maxInlineFindings)
    });
  }

  return selected;
}
