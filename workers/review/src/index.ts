import { createControlPlaneDatabase } from '@code-reviewer/db';
import { handleJob } from './handlers';
import { D1QueueAdapter } from './queue';
import { ReviewWorkerConfig } from './config';

type Env = {
  DB: D1Database;
  GITHUB_API_BASE_URL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_MODEL?: string;
  REVIEW_WORKER_MAX_RETRIES?: string;
  INDEX_MAX_FILE_BYTES?: string;
  INDEX_MAX_CHUNK_LINES?: string;
};

let secretsValidated = false;
function validateSecrets(env: Env): void {
  if (secretsValidated) return;
  secretsValidated = true;
  if (!env.AI_GATEWAY_BASE_URL || !env.AI_GATEWAY_API_KEY) {
    console.warn('[config] AI_GATEWAY_BASE_URL / AI_GATEWAY_API_KEY missing — reviews will be skipped');
  }
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    console.warn('[config] GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY missing — cannot post PR comments');
  }
}

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
    githubApiBaseUrl: env.GITHUB_API_BASE_URL?.trim() || 'https://api.github.com',
    githubAppId: env.GITHUB_APP_ID?.trim() || undefined,
    githubAppPrivateKey: env.GITHUB_APP_PRIVATE_KEY?.trim().replace(/\\n/g, '\n') || undefined,
    aiGatewayBaseUrl: env.AI_GATEWAY_BASE_URL?.trim() || undefined,
    aiGatewayApiKey: env.AI_GATEWAY_API_KEY?.trim() || undefined,
    aiGatewayModel: env.AI_GATEWAY_MODEL?.trim() || 'auto',
  };
}

async function processJobs(env: Env): Promise<void> {
  validateSecrets(env);
  const config = buildConfig(env);

  const queue = new D1QueueAdapter(env.DB);
  const db = createControlPlaneDatabase({ d1: env.DB });

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
    queue.end();
  }
}

// ─── Webhook signature verification ──────────────────────────────────────────

async function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
  );
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  return signature === `sha256=${hex}`;
}

// ─── GitHub App Webhook Handler ──────────────────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const event = request.headers.get('x-github-event');
  const body = await request.text();

  // Verify signature if secret is configured
  if (env.GITHUB_WEBHOOK_SECRET) {
    const signature = request.headers.get('x-hub-signature-256');
    const valid = await verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, body, signature);
    if (!valid) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  // Only handle pull_request events
  if (event !== 'pull_request') {
    return new Response('OK', { status: 200 });
  }

  const payload = JSON.parse(body);
  const action = payload.action;

  // Only review on opened or synchronize (new push to PR)
  if (action !== 'opened' && action !== 'synchronize') {
    return new Response('OK', { status: 200 });
  }

  const pr = payload.pull_request;
  const repo = payload.repository;
  const installationId = payload.installation?.id;

  if (!pr || !repo || !installationId) {
    return new Response('Missing PR/repo/installation data', { status: 400 });
  }

  console.log(
    `[webhook] PR ${action}: ${repo.full_name}#${pr.number} (installation=${installationId})`,
  );

  // Enqueue a review job
  try {
    const jobId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO review_jobs (id, repository_id, pr_number, head_sha, installation_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', datetime('now'))`,
    )
      .bind(jobId, repo.id.toString(), pr.number, pr.head.sha, installationId.toString())
      .run();

    console.log(`[webhook] Enqueued review job ${jobId} for ${repo.full_name}#${pr.number}`);
    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[webhook] Failed to enqueue: ${err}`);
    return new Response('Internal error', { status: 500 });
  }
}

// ─── Worker Export ───────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<void> {
    ctx.waitUntil(processJobs(env));
  },
};
