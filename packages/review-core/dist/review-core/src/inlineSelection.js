"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectInlineComments = selectInlineComments;
const findings_1 = require("./findings");
const comments_1 = require("./comments");
function selectInlineComments(findings, parsedDiff, options) {
    if (options.maxInlineFindings <= 0) {
        return [];
    }
    const selected = [];
    const seen = new Set();
    const eligible = (0, findings_1.sortBySeverity)(findings.filter(finding => !!finding.filePath &&
        !!finding.line &&
        (0, findings_1.meetsSeverityThreshold)(finding.severity, options.minInlineSeverity)));
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
            body: (0, comments_1.buildInlineFindingComment)(finding, selected.length + 1, options.maxInlineFindings)
        });
    }
    return selected;
}
