# Review Worker Skeleton (v1)

This worker is the asynchronous execution-plane skeleton for v1.

## Current Behavior

- Pulls jobs from separate indexing/review queues (in-memory adapter for now).
- Handles two job kinds:
  - `indexing`
  - `review`
- Applies retry budget per job before final failure.
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
- `INDEX_MAX_FILE_BYTES` (default `10485760`, i.e. `10MB`)
- `CF_REVIEW_QUEUE_NAME` (default `review-jobs`)
- `CF_INDEXING_QUEUE_NAME` (default `indexing-jobs`)

## Next Integration Steps

1. Replace in-memory queue with durable queue (SQS/NATS/Redis streams).
1. Replace in-memory queue with Cloudflare Queues adapter.
2. Add idempotency keys per job for at-least-once delivery.
3. Persist run/indexing status to database.
4. Wire review job to gateway client + rule engine.
5. Add dead-letter queue and replay tooling.
