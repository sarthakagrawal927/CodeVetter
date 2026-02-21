import { loadReviewWorkerConfig } from './config';
import { handleJob } from './handlers';
import { createDefaultSeedJobs, InMemoryQueueAdapter } from './queue';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processJobWithRetry(
  job: Parameters<typeof handleJob>[0],
  maxRetries: number,
  maxIndexFileBytes: number
): Promise<void> {
  let attempt = 0;

  while (true) {
    try {
      await handleJob(job, { maxIndexFileBytes });
      return;
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[worker-review] retry=${attempt}/${maxRetries} kind=${job.kind} reason=${message}`
      );
    }
  }
}

async function run() {
  const config = loadReviewWorkerConfig();
  const queue = new InMemoryQueueAdapter(createDefaultSeedJobs());

  console.log(
    `[worker-review] started pollIntervalMs=${config.pollIntervalMs} ` +
      `maxIterations=${config.maxIterations} maxRetries=${config.maxRetries} ` +
      `reviewQueue=${config.reviewQueueName} indexingQueue=${config.indexingQueueName} ` +
      `indexMaxFileBytes=${config.maxIndexFileBytes}`
  );

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
        await processJobWithRetry(job, config.maxRetries, config.maxIndexFileBytes);
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

  console.log('[worker-review] max iterations reached, exiting.');
}

void run();
