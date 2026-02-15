import { InlineReviewComment, ReviewFinding, ReviewSeverity } from '../../shared-types/src';
import { ParsedDiff } from './diff';
export declare function selectInlineComments(findings: ReviewFinding[], parsedDiff: ParsedDiff, options: {
    maxInlineFindings: number;
    minInlineSeverity: ReviewSeverity;
}): InlineReviewComment[];
