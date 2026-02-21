import { IndexingJob, ReviewJob, WorkerJob } from '@code-reviewer/shared-types';

function now(): string {
  return new Date().toISOString();
}

type HandlerConfig = {
  maxIndexFileBytes: number;
};

async function handleIndexingJob(job: IndexingJob, config: HandlerConfig): Promise<void> {
  // Placeholder for repository ingestion + indexing pipeline.
  console.log(
    `[worker-review] [${now()}] indexing repository=${job.payload.repositoryId} ` +
      `ref=${job.payload.sourceRef || 'default'} maxFileBytes=${config.maxIndexFileBytes}`
  );
}

async function handleReviewJob(job: ReviewJob): Promise<void> {
  // Placeholder for policy-aware PR review pipeline.
  console.log(
    `[worker-review] [${now()}] review repository=${job.payload.repositoryId} ` +
      `pr=${job.payload.prNumber} sha=${job.payload.headSha}`
  );
}

export async function handleJob(job: WorkerJob, config: HandlerConfig): Promise<void> {
  switch (job.kind) {
    case 'indexing':
      await handleIndexingJob(job, config);
      break;
    case 'review':
      await handleReviewJob(job);
      break;
    default: {
      const neverJob: never = job;
      throw new Error(`Unhandled job kind: ${String((neverJob as WorkerJob).kind)}`);
    }
  }
}
