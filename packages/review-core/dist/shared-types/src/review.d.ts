export declare const REVIEW_SEVERITIES: readonly ["low", "medium", "high", "critical"];
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
export type ReviewFinding = {
    severity: ReviewSeverity;
    title: string;
    summary: string;
    filePath?: string;
    line?: number;
    confidence?: number;
};
export type InlineReviewComment = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
};
export type ReviewScore = {
    quality: number;
    risk: number;
    value: number;
    composite: number;
};
export type ReviewResult = {
    findings: ReviewFinding[];
    score: ReviewScore;
    summaryMarkdown: string;
    inlineComments: InlineReviewComment[];
};
