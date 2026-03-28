/**
 * Semantic Indexing — detect duplicate/similar code in diffs.
 *
 * Strategy (no tree-sitter dependency, works in browser):
 * 1. Parse diff to extract added functions/classes via regex patterns
 * 2. Normalize and hash function bodies for exact-match detection
 * 3. Use token-level similarity (Jaccard) for fuzzy matching
 * 4. Report findings when a new function is similar to an existing one
 *
 * This is a lightweight approach that works without native dependencies.
 * Tree-sitter support can be added later for more accurate extraction.
 */

import type { ReviewFinding } from '@code-reviewer/shared-types';

// ─── Symbol Extraction ────────────────────────────────────────────────────────

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'class' | 'type' | 'const';
  filePath: string;
  startLine: number;
  body: string;
  tokens: Set<string>;
}

/**
 * Extract function/class/type definitions from source code.
 * Uses language-agnostic regex patterns.
 */
export function extractSymbols(code: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = code.split('\n');

  // Patterns for common constructs
  const patterns: Array<{
    regex: RegExp;
    kind: CodeSymbol['kind'];
    nameGroup: number;
  }> = [
    // TypeScript/JavaScript functions
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'function', nameGroup: 1 },
    { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/, kind: 'function', nameGroup: 1 },
    { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/, kind: 'function', nameGroup: 1 },
    // Python functions
    { regex: /^def\s+(\w+)\s*\(/, kind: 'function', nameGroup: 1 },
    { regex: /^async\s+def\s+(\w+)\s*\(/, kind: 'function', nameGroup: 1 },
    // Rust functions
    { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, kind: 'function', nameGroup: 1 },
    // Go functions
    { regex: /^func\s+(\w+)\s*\(/, kind: 'function', nameGroup: 1 },
    // Classes
    { regex: /^(?:export\s+)?class\s+(\w+)/, kind: 'class', nameGroup: 1 },
    { regex: /^class\s+(\w+)/, kind: 'class', nameGroup: 1 },
    { regex: /^(?:pub\s+)?struct\s+(\w+)/, kind: 'class', nameGroup: 1 },
    // Types
    { regex: /^(?:export\s+)?(?:type|interface)\s+(\w+)/, kind: 'type', nameGroup: 1 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    for (const { regex, kind, nameGroup } of patterns) {
      const match = trimmed.match(regex);
      if (match) {
        const name = match[nameGroup];
        // Capture body (heuristic: until next top-level definition or blank line sequence)
        const body = captureBody(lines, i);
        symbols.push({
          name,
          kind,
          filePath,
          startLine: i + 1,
          body,
          tokens: tokenize(body),
        });
        break;
      }
    }
  }

  return symbols;
}

/** Capture the body of a function/class starting at the given line. */
function captureBody(lines: string[], startIdx: number): string {
  const bodyLines: string[] = [];
  let braceDepth = 0;
  let indentDepth = -1;
  let foundOpening = false;

  for (let i = startIdx; i < Math.min(startIdx + 200, lines.length); i++) {
    const line = lines[i];
    bodyLines.push(line);

    // Track brace-delimited blocks (JS/TS/Rust/Go/Java)
    for (const ch of line) {
      if (ch === '{') { braceDepth++; foundOpening = true; }
      if (ch === '}') braceDepth--;
    }
    if (foundOpening && braceDepth <= 0 && i > startIdx) break;

    // Track indent-delimited blocks (Python)
    if (i === startIdx) {
      indentDepth = line.length - line.trimStart().length;
    } else if (!foundOpening && line.trim().length > 0) {
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent <= indentDepth && i > startIdx + 1) break;
    }
  }

  return bodyLines.join('\n');
}

/** Tokenize code into a set of meaningful tokens for similarity comparison. */
function tokenize(code: string): Set<string> {
  // Remove comments and string literals, split on non-word chars
  const cleaned = code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/#.*$/gm, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  const tokens = cleaned
    .split(/[^a-zA-Z0-9_]+/)
    .filter((t) => t.length > 2);

  return new Set(tokens);
}

// ─── Similarity Detection ─────────────────────────────────────────────────────

/** Jaccard similarity between two token sets. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicateMatch {
  newSymbol: CodeSymbol;
  existingSymbol: CodeSymbol;
  similarity: number;
}

/**
 * Find duplicate or near-duplicate symbols between new (added) code
 * and existing code in the repository.
 */
export function findDuplicates(
  newSymbols: CodeSymbol[],
  existingSymbols: CodeSymbol[],
  threshold = 0.7,
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const ns of newSymbols) {
    for (const es of existingSymbols) {
      // Skip same-file same-name (it's an update, not a duplicate)
      if (ns.filePath === es.filePath && ns.name === es.name) continue;
      // Must be same kind
      if (ns.kind !== es.kind) continue;

      const sim = jaccardSimilarity(ns.tokens, es.tokens);
      if (sim >= threshold) {
        matches.push({ newSymbol: ns, existingSymbol: es, similarity: sim });
      }
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

// ─── Diff-based Analysis ──────────────────────────────────────────────────────

/** Parse a unified diff to extract added code per file. */
export function extractAddedCode(diff: string): Array<{ filePath: string; code: string; startLine: number }> {
  const results: Array<{ filePath: string; code: string; startLine: number }> = [];
  const fileBlocks = diff.split(/^diff --git /m).filter(Boolean);

  for (const block of fileBlocks) {
    // Extract file path
    const pathMatch = block.match(/^a\/\S+ b\/(\S+)/);
    if (!pathMatch) continue;
    const filePath = pathMatch[1];

    // Extract added lines from hunks
    const hunks = block.split(/^@@/m).slice(1);
    for (const hunk of hunks) {
      const lineMatch = hunk.match(/^\s*-\d+(?:,\d+)?\s*\+(\d+)/);
      const startLine = lineMatch ? parseInt(lineMatch[1], 10) : 1;

      const addedLines: string[] = [];
      for (const line of hunk.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          addedLines.push(line.slice(1));
        }
      }

      if (addedLines.length > 3) {
        results.push({
          filePath,
          code: addedLines.join('\n'),
          startLine,
        });
      }
    }
  }

  return results;
}

/**
 * Analyze a diff for duplicate code and return findings.
 * `existingCode` is a map of filePath → file content for the repo.
 */
export function analyzeDiffForDuplicates(
  diff: string,
  existingCode: Map<string, string>,
  threshold = 0.7,
): ReviewFinding[] {
  // Extract symbols from added code
  const addedBlocks = extractAddedCode(diff);
  const newSymbols: CodeSymbol[] = [];
  for (const block of addedBlocks) {
    newSymbols.push(...extractSymbols(block.code, block.filePath));
  }

  if (newSymbols.length === 0) return [];

  // Extract symbols from existing code
  const existingSymbols: CodeSymbol[] = [];
  for (const [filePath, code] of existingCode) {
    existingSymbols.push(...extractSymbols(code, filePath));
  }

  // Find duplicates
  const duplicates = findDuplicates(newSymbols, existingSymbols, threshold);

  // Convert to review findings
  return duplicates.map((dup) => ({
    severity: dup.similarity >= 0.9 ? 'high' as const : 'medium' as const,
    title: `Possible duplicate: ${dup.newSymbol.name}`,
    summary: `${dup.newSymbol.kind} "${dup.newSymbol.name}" in ${dup.newSymbol.filePath} is ${Math.round(dup.similarity * 100)}% similar to "${dup.existingSymbol.name}" in ${dup.existingSymbol.filePath}:${dup.existingSymbol.startLine}`,
    suggestion: `Consider reusing "${dup.existingSymbol.name}" from ${dup.existingSymbol.filePath} instead of creating a new ${dup.newSymbol.kind}.`,
    filePath: dup.newSymbol.filePath,
    line: dup.newSymbol.startLine,
    confidence: dup.similarity,
  }));
}
