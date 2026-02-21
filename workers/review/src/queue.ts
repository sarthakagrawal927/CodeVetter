import { IndexingJob, ReviewJob } from '@code-reviewer/shared-types';

export interface JobQueueAdapter {
  pullReviewJobs(batchSize: number): Promise<ReviewJob[]>;
  pullIndexingJobs(batchSize: number): Promise<IndexingJob[]>;
}

export class InMemoryQueueAdapter implements JobQueueAdapter {
  private reviewQueue: ReviewJob[];
  private indexingQueue: IndexingJob[];

  constructor(seed: { reviews: ReviewJob[]; indexing: IndexingJob[] }) {
    this.reviewQueue = [...seed.reviews];
    this.indexingQueue = [...seed.indexing];
  }

  async pullReviewJobs(batchSize: number): Promise<ReviewJob[]> {
    if (batchSize <= 0) {
      return [];
    }

    const next = this.reviewQueue.slice(0, batchSize);
    this.reviewQueue = this.reviewQueue.slice(batchSize);
    return next;
  }

  async pullIndexingJobs(batchSize: number): Promise<IndexingJob[]> {
    if (batchSize <= 0) {
      return [];
    }

    const next = this.indexingQueue.slice(0, batchSize);
    this.indexingQueue = this.indexingQueue.slice(batchSize);
    return next;
  }
}

export class CloudflareQueuesAdapter implements JobQueueAdapter {
  constructor(
    private readonly reviewQueueName: string,
    private readonly indexingQueueName: string
  ) {}

  async pullReviewJobs(_batchSize: number): Promise<ReviewJob[]> {
    // TODO(v1): integrate Cloudflare Queue consumer bindings.
    void this.reviewQueueName;
    return [];
  }

  async pullIndexingJobs(_batchSize: number): Promise<IndexingJob[]> {
    // TODO(v1): integrate Cloudflare Queue consumer bindings.
    void this.indexingQueueName;
    return [];
  }
}

export function createDefaultSeedJobs(): { reviews: ReviewJob[]; indexing: IndexingJob[] } {
  return {
    indexing: [
      {
        kind: 'indexing',
        payload: {
          repositoryId: 'repo_1',
          sourceRef: 'main',
        },
      },
    ],
    reviews: [
      {
        kind: 'review',
        payload: {
          repositoryId: 'repo_1',
          prNumber: 42,
          headSha: 'placeholder-sha',
          triggeredBy: 'manual',
        },
      },
    ],
  };
}
