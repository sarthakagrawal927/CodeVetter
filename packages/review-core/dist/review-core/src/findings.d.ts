import { ReviewFinding, ReviewSeverity } from '../../shared-types/src';
export declare function parseSeverity(value: string, fallback?: ReviewSeverity): ReviewSeverity;
export declare function meetsSeverityThreshold(severity: ReviewSeverity, threshold: ReviewSeverity): boolean;
export declare function severityWeight(severity: ReviewSeverity): number;
export declare function sortBySeverity(findings: ReviewFinding[]): ReviewFinding[];
export declare function normalizeFindings(rawFindings: ReviewFinding[]): ReviewFinding[];
