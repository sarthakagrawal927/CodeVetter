"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractChangedLinesFromPatch = extractChangedLinesFromPatch;
exports.parseDiffFiles = parseDiffFiles;
function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function extractChangedLinesFromPatch(path, patch) {
    const lines = patch.split('\n');
    const changedLines = [];
    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;
    for (const line of lines) {
        if (line.startsWith('@@')) {
            const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            if (!match) {
                inHunk = false;
                continue;
            }
            oldLine = Number(match[1]);
            newLine = Number(match[2]);
            inHunk = true;
            continue;
        }
        if (!inHunk) {
            continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) {
            changedLines.push({
                path,
                line: newLine,
                side: 'RIGHT',
                text: line.slice(1)
            });
            newLine += 1;
            continue;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
            changedLines.push({
                path,
                line: oldLine,
                side: 'LEFT',
                text: line.slice(1)
            });
            oldLine += 1;
            continue;
        }
        if (line.startsWith(' ')) {
            oldLine += 1;
            newLine += 1;
            continue;
        }
        if (line.startsWith('\\')) {
            continue;
        }
    }
    return changedLines;
}
function parseDiffFiles(files) {
    const changedLines = [];
    const lineSideIndex = new Map();
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
        additions += clampNumber(file.additions ?? 0, 0, Number.MAX_SAFE_INTEGER);
        deletions += clampNumber(file.deletions ?? 0, 0, Number.MAX_SAFE_INTEGER);
        if (!file.patch) {
            continue;
        }
        const fileChangedLines = extractChangedLinesFromPatch(file.path, file.patch);
        changedLines.push(...fileChangedLines);
        for (const line of fileChangedLines) {
            if (!lineSideIndex.has(line.path)) {
                lineSideIndex.set(line.path, new Map());
            }
            const sideMap = lineSideIndex.get(line.path);
            if (!sideMap) {
                continue;
            }
            sideMap.set(line.line, line.side);
        }
    }
    return {
        changedLines,
        lineSideIndex,
        stats: {
            fileCount: files.length,
            changedLineCount: changedLines.length,
            additions,
            deletions
        }
    };
}
