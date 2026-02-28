import { loadReviewWorkerConfig } from './config';
import { handleJob } from './handlers';
import { createDefaultSeedJobs, InMemoryQueueAdapter, PostgresQueueAdapter } from './queue';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const factor = 2 ** Math.max(0, attempt - 1);
  return Math.min(maxDelayMs, baseDelayMs * factor);
}

async function processJobWithRetry(
  job: Parameters<typeof handleJob>[0],
  maxRetries: number,
  maxIndexFileBytes: number,
  indexChunkStrategy: 'tree-sitter',
  indexMaxChunkLines: number,
  retryBaseDelayMs: number,
  retryMaxDelayMs: number
): Promise<void> {
  let attempt = 0;

  while (true) {
    try {
      await handleJob(job, { maxIndexFileBytes, indexChunkStrategy, indexMaxChunkLines });
      return;
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      const retryDelayMs = computeBackoffMs(attempt, retryBaseDelayMs, retryMaxDelayMs);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[worker-review] retry=${attempt}/${maxRetries} kind=${job.kind} ` +
          `nextRetryInMs=${retryDelayMs} reason=${message}`
      );
      await delay(retryDelayMs);
    }
  }
}

async function run() {
  const config = loadReviewWorkerConfig();
  const queue = config.cockroachDatabaseUrl
    ? new PostgresQueueAdapter(config.cockroachDatabaseUrl)
    : new InMemoryQueueAdapter(createDefaultSeedJobs());

  console.log(
    `[worker-review] started pollIntervalMs=${config.pollIntervalMs} ` +
      `maxIterations=${config.maxIterations} maxRetries=${config.maxRetries} ` +
      `retryBaseMs=${config.retryBaseDelayMs} retryMaxMs=${config.retryMaxDelayMs} ` +
      `reviewQueue=${config.reviewQueueName} indexingQueue=${config.indexingQueueName} ` +
      `indexMaxFileBytes=${config.maxIndexFileBytes} ` +
      `indexChunkStrategy=${config.indexChunkStrategy} indexMaxChunkLines=${config.indexMaxChunkLines} ` +
      `aiGateway=${config.aiGatewayBaseUrl || 'unset'} ` +
      `model=${config.aiGatewayModel} ` +
      `db=${config.cockroachDatabaseUrl ? 'configured' : 'in-memory'} ` +
      `githubApp=${config.githubAppId || 'unset'}`
  );

  const shutdown = async () => {
    console.log('[worker-review] shutting down...');
    if ('end' in queue && typeof (queue as { end?: () => Promise<void> }).end === 'function') {
      await (queue as { end: () => Promise<void> }).end();
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });

  try {
    for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
      const [indexingJobs, reviewJobs] = await Promise.all([
        queue.pullIndexingJobs(5),
        queue.pullReviewJobs(5),
      ]);
      const jobs = [...indexingJobs, ...reviewJobs];

      if (jobs.length === 0) {
        console.log(`[worker-review] iteration=${iteration} queue empty`);
        await delay(config.pollIntervalMs);
        continue;
      }

      console.log(`[worker-review] iteration=${iteration} pulled=${jobs.length}`);

      for (const job of jobs) {
        try {
          await processJobWithRetry(
            job,
            config.maxRetries,
            config.maxIndexFileBytes,
            config.indexChunkStrategy,
            config.indexMaxChunkLines,
            config.retryBaseDelayMs,
            config.retryMaxDelayMs
          );
        } catch (error) {
          console.error(
            `[worker-review] job failed kind=${job.kind} error=${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      await delay(config.pollIntervalMs);
    }
  } finally {
    if ('end' in queue && typeof (queue as { end?: () => Promise<void> }).end === 'function') {
      await (queue as { end: () => Promise<void> }).end();
    }
  }

  console.log('[worker-review] max iterations reached, exiting.');
}

void run();
