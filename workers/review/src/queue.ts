import { Pool } from 'pg';
import { IndexingJob, ReviewJob } from '@code-reviewer/shared-types';

export interface JobQueueAdapter {
  pullReviewJobs(batchSize: number): Promise<ReviewJob[]>;
  pullIndexingJobs(batchSize: number): Promise<IndexingJob[]>;
}

// ── In-memory (dev / fallback) ────────────────────────────────────────────────

export class InMemoryQueueAdapter implements JobQueueAdapter {
  private reviewQueue: ReviewJob[];
  private indexingQueue: IndexingJob[];

  constructor(seed: { reviews: ReviewJob[]; indexing: IndexingJob[] }) {
    this.reviewQueue = [...seed.reviews];
    this.indexingQueue = [...seed.indexing];
  }

  async pullReviewJobs(batchSize: number): Promise<ReviewJob[]> {
    if (batchSize <= 0) return [];
    const next = this.reviewQueue.slice(0, batchSize);
    this.reviewQueue = this.reviewQueue.slice(batchSize);
    return next;
  }

  async pullIndexingJobs(batchSize: number): Promise<IndexingJob[]> {
    if (batchSize <= 0) return [];
    const next = this.indexingQueue.slice(0, batchSize);
    this.indexingQueue = this.indexingQueue.slice(batchSize);
    return next;
  }
}

// ── Postgres / CockroachDB ────────────────────────────────────────────────────

const knownTriggers: Array<ReviewJob['payload']['triggeredBy']> = ['webhook', 'manual', 'action'];

export class PostgresQueueAdapter implements JobQueueAdapter {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30000 });
  }

  async pullReviewJobs(batchSize: number): Promise<ReviewJob[]> {
    if (batchSize <= 0) return [];
    const result = await this.pool.query<{
      id: string;
      repository_id: string;
      pr_number: number;
      head_sha: string | null;
      trigger_source: string;
    }>(
      `UPDATE review_runs
         SET status = 'processing', started_at = NOW()
       WHERE id IN (
         SELECT id FROM review_runs
         WHERE status = 'pending'
         -- ORDER BY id gives consistent claim ordering; for strict FIFO
         -- add a created_at column and ORDER BY created_at, id
         ORDER BY id
         LIMIT $1
       )
       RETURNING id, repository_id, pr_number, head_sha, trigger_source`,
      [batchSize]
    );

    return result.rows
      .filter(row => row.head_sha)
      .map(row => {
        const triggeredBy = knownTriggers.includes(row.trigger_source as ReviewJob['payload']['triggeredBy'])
          ? (row.trigger_source as ReviewJob['payload']['triggeredBy'])
          : 'webhook';
        return {
          kind: 'review' as const,
          payload: {
            reviewRunId: row.id,
            repositoryId: row.repository_id,
            prNumber: row.pr_number,
            headSha: row.head_sha as string,
            triggeredBy,
          },
        };
      });
  }

  async pullIndexingJobs(batchSize: number): Promise<IndexingJob[]> {
    if (batchSize <= 0) return [];
    const result = await this.pool.query<{
      id: string;
      repository_id: string;
      source_ref: string | null;
    }>(
      `UPDATE indexing_runs
         SET status = 'processing', started_at = NOW()
       WHERE id IN (
         SELECT id FROM indexing_runs
         WHERE status = 'pending'
         -- ORDER BY id gives consistent claim ordering; for strict FIFO
         -- add a created_at column and ORDER BY created_at, id
         ORDER BY id
         LIMIT $1
       )
       RETURNING id, repository_id, source_ref`,
      [batchSize]
    );

    return result.rows.map(row => ({
      kind: 'indexing' as const,
      payload: {
        indexingRunId: row.id,
        repositoryId: row.repository_id,
        sourceRef: row.source_ref || undefined,
      },
    }));
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function createDefaultSeedJobs(): { reviews: ReviewJob[]; indexing: IndexingJob[] } {
  return { indexing: [], reviews: [] };
}
