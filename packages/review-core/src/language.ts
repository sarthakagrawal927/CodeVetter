import type { IndexedCodeLanguage } from '@code-reviewer/shared-types';

/** File extension to language mapping */
const EXTENSION_MAP: Record<string, IndexedCodeLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.rs': 'rust',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.sql': 'sql',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.md': 'markdown',
};

/** Supported file extensions for indexing */
const INDEXABLE_EXTENSIONS = new Set(Object.keys(EXTENSION_MAP));

/** Detect the programming language from a file path */
export function detectLanguage(path: string): IndexedCodeLanguage {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'other';
  const ext = path.slice(dot).toLowerCase();
  return EXTENSION_MAP[ext] ?? 'other';
}

/** Check if a file path has an indexable extension */
export function hasIndexableExtension(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return INDEXABLE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
