# v1 Indexing Spec (Semantic, Non-Vector)

## Goal

Ship a deterministic indexing pipeline for review context in v1, while keeping a clean migration path to embeddings/vector retrieval in v1.1.

## Strategy

- Full repository indexing from GitHub-tracked files.
- File guardrail: max `10MB` file size.
- Chunking mode: `tree-sitter`.
  - Primary boundaries: function/class/interface/module-like declarations.
  - Includes top-level function-valued `const` declarations (for example `const foo = () => {}`).
  - Fallback: module-level chunk when no symbols are detected.
  - Oversized symbol blocks are split by line windows.

## Stored Artifacts

1. File record
   - `repositoryId`, `sourceRef`, `path`, `blobSha`
   - `contentSha256`, `language`, `sizeBytes`, `chunkStrategy`, `indexedAt`
2. Semantic chunk record
   - stable `chunk id` from repo/ref/path/range/content hash
   - `symbolKind`, optional `symbolName`
   - `startLine`, `endLine`, `chunkOrdinal`
   - `content`, `contentSha256`

## Retrieval (v1)

- Use changed hunks + nearby syntax chunks + same-module chunks.
- No vector DB and no embedding lookup in v1.

## v1.1 Migration Path

- Keep chunk IDs stable and reuse existing chunk tables.
- Add embedding side table keyed by `chunk_id`.
- Backfill embeddings incrementally by `contentSha256` diff.
