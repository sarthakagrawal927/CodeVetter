import { createControlPlaneDatabase } from '@code-reviewer/db';
import { handleJob } from './handlers';
import { PostgresQueueAdapter } from './queue';
import { ReviewWorkerConfig } from './config';

type Env = {
  COCKROACH_DATABASE_URL?: string;
  GITHUB_API_BASE_URL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_MODEL?: string;
  REVIEW_WORKER_MAX_RETRIES?: string;
  INDEX_MAX_FILE_BYTES?: string;
  INDEX_MAX_CHUNK_LINES?: string;
};

function buildConfig(env: Env): ReviewWorkerConfig {
  return {
    pollIntervalMs: 2000,
    maxIterations: 1,
    maxRetries: Number(env.REVIEW_WORKER_MAX_RETRIES?.trim() || '3'),
    retryBaseDelayMs: 1000,
    retryMaxDelayMs: 30000,
    maxIndexFileBytes: Number(env.INDEX_MAX_FILE_BYTES?.trim() || String(10 * 1024 * 1024)),
    indexChunkStrategy: 'tree-sitter',
    indexMaxChunkLines: Number(env.INDEX_MAX_CHUNK_LINES?.trim() || '220'),
    reviewQueueName: 'review-jobs',
    indexingQueueName: 'indexing-jobs',
    cockroachDatabaseUrl: env.COCKROACH_DATABASE_URL?.trim() || undefined,
    githubApiBaseUrl: env.GITHUB_API_BASE_URL?.trim() || 'https://api.github.com',
    githubAppId: env.GITHUB_APP_ID?.trim() || undefined,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY?.trim().replace(/\\n/g, '\n') || undefined,
    aiGatewayBaseUrl: env.AI_GATEWAY_BASE_URL?.trim() || undefined,
    aiGatewayApiKey: env.AI_GATEWAY_API_KEY?.trim() || undefined,
    aiGatewayModel: env.AI_GATEWAY_MODEL?.trim() || 'auto',
  };
}

async function processJobs(env: Env): Promise<void> {
  const config = buildConfig(env);

  if (!config.cockroachDatabaseUrl) {
    console.error('[review-worker] COCKROACH_DATABASE_URL not set — skipping');
    return;
  }

  const queue = new PostgresQueueAdapter(config.cockroachDatabaseUrl);
  const db = createControlPlaneDatabase({ cockroachDatabaseUrl: config.cockroachDatabaseUrl });

  try {
    const [indexingJobs, reviewJobs] = await Promise.all([
      queue.pullIndexingJobs(5),
      queue.pullReviewJobs(5),
    ]);
    const jobs = [...indexingJobs, ...reviewJobs];

    if (jobs.length === 0) {
      console.log('[review-worker] no queued jobs');
      return;
    }

    console.log(`[review-worker] processing ${jobs.length} jobs`);

    for (const job of jobs) {
      try {
        await handleJob(job, {
          maxIndexFileBytes: config.maxIndexFileBytes,
          indexChunkStrategy: config.indexChunkStrategy,
          indexMaxChunkLines: config.indexMaxChunkLines,
          workerConfig: config,
          db,
        });
      } catch (err) {
        console.error(
          `[review-worker] job failed kind=${job.kind}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } finally {
    await queue.end();
  }
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<void> {
    ctx.waitUntil(processJobs(env));
  },
};
