import { GatewayReviewFile } from '../../shared-types/src';

export type ChangedLine = {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  text: string;
};

export type ParsedDiff = {
  changedLines: ChangedLine[];
  lineSideIndex: Map<string, Map<number, 'LEFT' | 'RIGHT'>>;
  stats: {
    fileCount: number;
    changedLineCount: number;
    additions: number;
    deletions: number;
  };
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function extractChangedLinesFromPatch(path: string, patch: string): ChangedLine[] {
  const lines = patch.split('\n');
  const changedLines: ChangedLine[] = [];

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

export function parseDiffFiles(files: GatewayReviewFile[]): ParsedDiff {
  const changedLines: ChangedLine[] = [];
  const lineSideIndex = new Map<string, Map<number, 'LEFT' | 'RIGHT'>>();

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
        lineSideIndex.set(line.path, new Map<number, 'LEFT' | 'RIGHT'>());
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
