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

// ── Helpers ───────────────────────────────────────────────────────────────────

export function createDefaultSeedJobs(): { reviews: ReviewJob[]; indexing: IndexingJob[] } {
  return { indexing: [], reviews: [] };
}
