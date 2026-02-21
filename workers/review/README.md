# Review Worker Skeleton (v1)

This worker is the asynchronous execution-plane skeleton for v1.

## Current Behavior

- Pulls jobs from separate indexing/review queues (in-memory adapter for now).
- Handles two job kinds:
  - `indexing`
  - `review`
- Indexing strategy in v1 is Tree-sitter syntax chunking (functions/classes/modules), not vector retrieval.
- Applies retry budget per job with exponential backoff before final failure.
- Logs job execution only (no external side effects yet).

## Run

```bash
npm run -w workers/review build
npm run -w workers/review start
```

Optional env vars:

- `REVIEW_WORKER_POLL_MS` (default `2000`)
- `REVIEW_WORKER_MAX_ITERATIONS` (default `10`)
- `REVIEW_WORKER_MAX_RETRIES` (default `3`)
- `REVIEW_WORKER_RETRY_BASE_MS` (default `1000`)
- `REVIEW_WORKER_RETRY_MAX_MS` (default `30000`)
- `INDEX_MAX_FILE_BYTES` (default `10485760`, i.e. `10MB`)
- `INDEX_CHUNK_STRATEGY` (default `tree-sitter`, only supported value in v1)
- `INDEX_MAX_CHUNK_LINES` (default `220`)
- `CF_REVIEW_QUEUE_NAME` (default `review-jobs`)
- `CF_INDEXING_QUEUE_NAME` (default `indexing-jobs`)

## Next Integration Steps

1. Replace in-memory queue with Cloudflare Queues adapter and queue-native delayed retries.
2. Add idempotency keys per job for at-least-once delivery.
3. Persist run/indexing status to database.
4. Wire review job to gateway client + rule engine.
5. Add dead-letter queue and replay tooling.
