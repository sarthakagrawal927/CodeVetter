import { createHash } from 'crypto';
import Parser = require('tree-sitter');
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';
import { tsx as TypeScriptTsx, typescript as TypeScript } from 'tree-sitter-typescript';
import {
  IndexedCodeLanguage,
  IndexedFileRecord,
  IndexedSymbolKind,
  SemanticChunkRecord,
} from '@code-reviewer/shared-types';

export type SourceFileForIndexing = {
  repositoryId: string;
  sourceRef: string;
  path: string;
  blobSha: string;
  content: string;
};

export type TreeSitterChunkingConfig = {
  maxFileBytes: number;
  maxChunkLines: number;
};

// Backward-compatible alias while we migrate callers.
export type SyntaxChunkingConfig = TreeSitterChunkingConfig;

type ChunkCandidate = {
  symbolKind: IndexedSymbolKind;
  symbolName?: string;
  startLine: number;
  endLine: number;
};

type TreeSitterGrammar = unknown;

const parser = new Parser();

const NODE_TYPES_BY_LANGUAGE: Partial<Record<IndexedCodeLanguage, string[]>> = {
  javascript: ['function_declaration', 'class_declaration', 'method_definition'],
  jsx: ['function_declaration', 'class_declaration', 'method_definition'],
  typescript: [
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'method_definition',
  ],
  tsx: [
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'method_definition',
  ],
  python: ['function_definition', 'class_definition'],
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function detectLanguage(path: string): IndexedCodeLanguage {
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.go')) return 'go';
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.cs')) return 'csharp';
  if (path.endsWith('.rb')) return 'ruby';
  if (path.endsWith('.php')) return 'php';
  if (path.endsWith('.rs')) return 'rust';
  if (path.endsWith('.kt')) return 'kotlin';
  if (path.endsWith('.swift')) return 'swift';
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'other';
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function grammarForLanguage(language: IndexedCodeLanguage): TreeSitterGrammar | null {
  switch (language) {
    case 'javascript':
    case 'jsx':
      return JavaScript;
    case 'typescript':
      return TypeScript;
    case 'tsx':
      return TypeScriptTsx;
    case 'python':
      return Python;
    default:
      return null;
  }
}

function extractSymbolKind(node: Parser.SyntaxNode): IndexedSymbolKind | null {
  switch (node.type) {
    case 'class_declaration':
    case 'class_definition':
      return 'class';
    case 'interface_declaration':
      return 'interface';
    case 'type_alias_declaration':
      return 'type';
    case 'enum_declaration':
      return 'enum';
    case 'method_definition':
      return 'method';
    case 'function_definition':
      return node.parent?.type === 'class_definition' ? 'method' : 'function';
    case 'function_declaration':
      return 'function';
    default:
      return null;
  }
}

function extractSymbolName(node: Parser.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) {
    return undefined;
  }

  const text = nameNode.text.trim();
  return text || undefined;
}

function computeNodeEndLine(node: Parser.SyntaxNode, lineCount: number): number {
  let endLine = node.endPosition.row + 1;
  if (node.endPosition.column === 0 && endLine > node.startPosition.row + 1) {
    endLine -= 1;
  }

  if (endLine < 1) return 1;
  if (endLine > lineCount) return lineCount;
  return endLine;
}

function clampCandidate(candidate: ChunkCandidate, maxChunkLines: number): ChunkCandidate[] {
  const totalLines = candidate.endLine - candidate.startLine + 1;
  if (totalLines <= maxChunkLines) {
    return [candidate];
  }

  const slices: ChunkCandidate[] = [];
  let start = candidate.startLine;

  while (start <= candidate.endLine) {
    const end = Math.min(candidate.endLine, start + maxChunkLines - 1);
    slices.push({
      symbolKind: candidate.symbolKind,
      symbolName: candidate.symbolName,
      startLine: start,
      endLine: end,
    });
    start = end + 1;
  }

  return slices;
}

function uniqueCandidates(candidates: ChunkCandidate[]): ChunkCandidate[] {
  const seen = new Set<string>();
  const result: ChunkCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.symbolKind}:${candidate.symbolName || ''}:${candidate.startLine}:${candidate.endLine}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(candidate);
  }

  return result;
}

function findTreeSitterCandidates(content: string, language: IndexedCodeLanguage): ChunkCandidate[] {
  const lines = splitLines(content);
  const grammar = grammarForLanguage(language);
  if (!grammar) {
    return [];
  }

  const nodeTypes = NODE_TYPES_BY_LANGUAGE[language];
  if (!nodeTypes || nodeTypes.length === 0) {
    return [];
  }

  try {
    parser.setLanguage(grammar);
    const tree = parser.parse(content);
    const nodes = tree.rootNode.descendantsOfType(nodeTypes as unknown as String[]);
    const candidates: ChunkCandidate[] = [];

    for (const node of nodes) {
      const symbolKind = extractSymbolKind(node);
      if (!symbolKind) {
        continue;
      }

      const startLine = node.startPosition.row + 1;
      const endLine = computeNodeEndLine(node, lines.length);
      if (endLine < startLine) {
        continue;
      }

      candidates.push({
        symbolKind,
        symbolName: extractSymbolName(node),
        startLine,
        endLine,
      });
    }

    return uniqueCandidates(
      candidates.sort((left, right) => {
        if (left.startLine !== right.startLine) {
          return left.startLine - right.startLine;
        }

        return left.endLine - right.endLine;
      })
    );
  } catch {
    return [];
  }
}

export function buildTreeSitterIndexForFile(
  file: SourceFileForIndexing,
  config: TreeSitterChunkingConfig
): { fileRecord: IndexedFileRecord; chunks: SemanticChunkRecord[] } {
  const sizeBytes = Buffer.byteLength(file.content, 'utf8');
  if (sizeBytes > config.maxFileBytes) {
    throw new Error(
      `File ${file.path} is ${sizeBytes} bytes, above maxFileBytes=${config.maxFileBytes}.`
    );
  }

  const language = detectLanguage(file.path);
  const fileContentSha256 = sha256(file.content);
  const indexedAt = new Date().toISOString();
  const lines = splitLines(file.content);

  const fileRecord: IndexedFileRecord = {
    id: `file_${sha256(`${file.repositoryId}:${file.sourceRef}:${file.path}:${fileContentSha256}`)}`,
    repositoryId: file.repositoryId,
    sourceRef: file.sourceRef,
    path: file.path,
    blobSha: file.blobSha,
    contentSha256: fileContentSha256,
    language,
    sizeBytes,
    indexedAt,
    chunkStrategy: 'tree-sitter',
  };

  const rawCandidates = findTreeSitterCandidates(file.content, language);
  const fallbackCandidates: ChunkCandidate[] =
    rawCandidates.length > 0
      ? rawCandidates
      : [
          {
            symbolKind: 'module',
            startLine: 1,
            endLine: Math.max(1, lines.length),
          },
        ];
  const candidates = fallbackCandidates.flatMap(candidate =>
    clampCandidate(candidate, Math.max(20, config.maxChunkLines))
  );

  const chunks: SemanticChunkRecord[] = [];
  let ordinal = 0;
  for (const candidate of candidates) {
    const content = lines.slice(candidate.startLine - 1, candidate.endLine).join('\n').trim();
    if (!content) {
      continue;
    }

    ordinal += 1;
    const contentSha256 = sha256(content);
    const id = `chunk_${sha256(
      `${file.repositoryId}:${file.sourceRef}:${file.path}:${candidate.startLine}:${candidate.endLine}:${contentSha256}`
    )}`;
    chunks.push({
      id,
      repositoryId: file.repositoryId,
      sourceRef: file.sourceRef,
      filePath: file.path,
      fileContentSha256,
      language,
      symbolKind: candidate.symbolKind,
      symbolName: candidate.symbolName,
      chunkOrdinal: ordinal,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      content,
      contentSha256,
      createdAt: indexedAt,
    });
  }

  return {
    fileRecord,
    chunks,
  };
}

// Backward-compatible alias while we migrate callers.
export const buildSyntaxAwareIndexForFile = buildTreeSitterIndexForFile;
