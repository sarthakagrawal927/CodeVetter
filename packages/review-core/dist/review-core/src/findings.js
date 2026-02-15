"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSeverity = parseSeverity;
exports.meetsSeverityThreshold = meetsSeverityThreshold;
exports.severityWeight = severityWeight;
exports.sortBySeverity = sortBySeverity;
exports.normalizeFindings = normalizeFindings;
const src_1 = require("../../shared-types/src");
const SEVERITY_RANK = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
};
function parseSeverity(value, fallback = 'medium') {
    const normalized = value.trim().toLowerCase();
    return src_1.REVIEW_SEVERITIES.includes(normalized)
        ? normalized
        : fallback;
}
function meetsSeverityThreshold(severity, threshold) {
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
function severityWeight(severity) {
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
function sortBySeverity(findings) {
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
function normalizeFindings(rawFindings) {
    const deduped = new Map();
    for (const raw of rawFindings) {
        const title = raw.title.trim();
        const summary = raw.summary.trim();
        if (!title || !summary) {
            continue;
        }
        const severity = src_1.REVIEW_SEVERITIES.includes(raw.severity) ? raw.severity : 'medium';
        const finding = {
            severity,
            title,
            summary,
            filePath: raw.filePath?.trim() || undefined,
            line: typeof raw.line === 'number' && Number.isInteger(raw.line) && raw.line > 0 ? raw.line : undefined,
            confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
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
