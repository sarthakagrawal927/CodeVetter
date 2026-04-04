import { ControlPlaneDatabase } from '@code-reviewer/db';
import { AIGatewayClient } from '@code-reviewer/ai-gateway-client';
import { IndexingJob, ReviewFindingRecord, ReviewJob, ReviewMode, WorkerJob, WorkspaceTier } from '@code-reviewer/shared-types';
import {
  computeScore,
  computeFindingFingerprint,
  determineReviewAction,
  buildOverallBody,
  hasIndexableExtension,
} from '@code-reviewer/review-core';
import type { ReviewComment, ReviewEvent } from '@code-reviewer/review-core';
import {
  getInstallationToken,
  getRepoTree,
  getFileContent,
  getPrDiff,
  getPrFiles,
  postPrReview,
} from './github';
import { ReviewWorkerConfig } from './config';
import { chunkFileWithTreeSitter } from './indexing';
import type { SourceFileForIndexing } from './indexing';

function nowIso(): string {
  return new Date().toISOString();
}

type HandlerConfig = {
  maxIndexFileBytes: number;
  indexChunkStrategy: 'tree-sitter';
  indexMaxChunkLines: number;
  workerConfig: ReviewWorkerConfig;
  db: ControlPlaneDatabase;
};

/** Fetch file contents with bounded concurrency */
async function fetchFilesContent(
  token: string,
  owner: string,
  repo: string,
  entries: Array<{ path: string; sha: string }>,
  apiBaseUrl?: string,
  concurrency = 10
): Promise<Map<string, { content: string; sha: string }>> {
  const result = new Map<string, { content: string; sha: string }>();
  const queue = [...entries];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const entry = queue.pop()!;
      try {
        const content = await getFileContent(token, owner, repo, entry.sha, apiBaseUrl);
        result.set(entry.path, { content, sha: entry.sha });
      } catch (err) {
        console.warn(
          `[worker-review] failed to fetch blob ${entry.path} (${entry.sha}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => worker());
  await Promise.all(workers);
  return result;
}

async function handleIndexingJob(job: IndexingJob, config: HandlerConfig): Promise<void> {
  const { indexingRunId, repositoryId, sourceRef } = job.payload;
  const wc = config.workerConfig;

  console.log(
    `[worker-review] indexing repository=${repositoryId} ` +
      `ref=${sourceRef || 'default'} runId=${indexingRunId || 'none'}`
  );

  if (!wc.githubAppId || !wc.githubAppPrivateKey) {
    console.warn('[worker-review] GitHub App credentials not set — skipping indexing');
    return;
  }

  const db = config.db;

  // Mark as running
  if (indexingRunId) {
    await db.updateIndexingRun(indexingRunId, { status: 'running' });
  }

  try {
    // 1. Load repository
    const repository = await db.getRepositoryById(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found in DB`);
    }

    const parts = repository.fullName.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repository fullName: ${repository.fullName}`);
    }
    const [owner, repoName] = parts as [string, string];
    const installationId = repository.installationId;
    if (!installationId) {
      throw new Error(`Repository ${repository.fullName} has no installationId`);
    }

    // 2. Get installation token
    const installToken = await getInstallationToken(
      { appId: wc.githubAppId, privateKey: wc.githubAppPrivateKey, apiBaseUrl: wc.githubApiBaseUrl },
      installationId
    );

    // 3. Resolve ref
    const ref = sourceRef || repository.defaultBranch || 'main';

    // 4. Fetch file tree from GitHub
    const treeEntries = await getRepoTree(installToken, owner, repoName, ref, wc.githubApiBaseUrl);

    // 5. Filter to indexable blobs within size limit
    const blobs = treeEntries.filter(
      (e) => e.type === 'blob' && hasIndexableExtension(e.path) && e.size <= config.maxIndexFileBytes
    );

    console.log(
      `[worker-review] indexing ${blobs.length} files out of ${treeEntries.length} tree entries`
    );

    // 6. Fetch file contents
    const fileContents = await fetchFilesContent(
      installToken,
      owner,
      repoName,
      blobs,
      wc.githubApiBaseUrl
    );

    // 7. Chunk each file
    const chunkConfig = {
      maxFileBytes: config.maxIndexFileBytes,
      maxChunkLines: config.indexMaxChunkLines,
    };

    let totalChunks = 0;
    const languageCounts: Record<string, number> = {};
    const allFiles: import('@code-reviewer/shared-types').IndexedFileRecord[] = [];
    const allChunks: import('@code-reviewer/shared-types').SemanticChunkRecord[] = [];

    for (const [filePath, { content, sha }] of fileContents) {
      const file: SourceFileForIndexing = {
        repositoryId,
        sourceRef: ref,
        path: filePath,
        blobSha: sha,
        content,
      };

      const { fileRecord, chunks } = await chunkFileWithTreeSitter(file, chunkConfig);
      totalChunks += chunks.length;
      allFiles.push(fileRecord);
      allChunks.push(...chunks);

      const lang = fileRecord.language;
      languageCounts[lang] = (languageCounts[lang] ?? 0) + 1;
    }

    // 8. Persist indexed files and chunks
    const batch: import('@code-reviewer/shared-types').SemanticIndexBatch = {
      repositoryId,
      sourceRef: ref,
      strategy: 'tree-sitter',
      files: allFiles,
      chunks: allChunks,
    };

    const { filesCreated, chunksCreated } = await db.saveIndexBatch(batch);
    console.log(`[worker-review] persisted ${filesCreated} files, ${chunksCreated} chunks`);

    // 9. Update indexing run with summary
    const summary = {
      fileCount: fileContents.size,
      chunkCount: totalChunks,
      languages: languageCounts,
    };

    if (indexingRunId) {
      await db.updateIndexingRun(indexingRunId, {
        status: 'completed',
        summary,
        completedAt: nowIso(),
      });
    }

    console.log(
      `[worker-review] indexing completed repository=${repository.fullName} ` +
        `files=${fileContents.size} chunks=${totalChunks}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker-review] indexing failed: ${msg}`);
    if (indexingRunId) {
      await db.updateIndexingRun(indexingRunId, {
        status: 'failed',
        errorMessage: msg,
        completedAt: nowIso(),
      });
    }
    throw err;
  }
}

async function handleReviewJob(job: ReviewJob, config: HandlerConfig): Promise<void> {
  const { reviewRunId, repositoryId, prNumber, headSha, reviewTier: jobTier } = job.payload;
  const wc = config.workerConfig;

  if (!wc.githubAppId || !wc.githubAppPrivateKey) {
    console.warn('[worker-review] GitHub App credentials not set — skipping review');
    return;
  }
  if (!wc.aiGatewayBaseUrl || !wc.aiGatewayApiKey) {
    console.warn('[worker-review] AI gateway not configured — skipping review');
    return;
  }

  const db = config.db;

  // 1. Load repository and PR metadata
  const repository = await db.getRepositoryById(repositoryId);
  if (!repository) {
    throw new Error(`Repository ${repositoryId} not found in DB`);
  }

  const parts = repository.fullName.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid repository fullName: ${repository.fullName}`);
  }
  const [owner, repoName] = parts as [string, string];
  const installationId = repository.installationId;
  if (!installationId) {
    throw new Error(`Repository ${repository.fullName} has no installationId`);
  }

  // Resolve workspace tier
  let reviewTier: WorkspaceTier = jobTier || 'free';
  if (!jobTier) {
    const workspace = await db.getWorkspaceForRepository(repositoryId);
    reviewTier = workspace?.tier || 'free';
  }

  // Load review run to get agent mode and parent linking
  const reviewRun = reviewRunId ? await db.getReviewRunById(reviewRunId) : undefined;
  const reviewMode: ReviewMode = reviewRun?.reviewMode || 'standard';
  const isAgent = reviewMode === 'agent';

  // Load pull request record to get agent name
  const pullRequest = reviewRun?.pullRequestId
    ? await db.getPullRequestById(reviewRun.pullRequestId)
    : undefined;

  // Load parent findings for re-review resolution
  let parentFindings: ReviewFindingRecord[] = [];
  if (reviewRun?.parentReviewRunId) {
    parentFindings = await db.listReviewFindingsByRun(reviewRun.parentReviewRunId);
  }

  // 2. Get installation token
  const installToken = await getInstallationToken(
    { appId: wc.githubAppId, privateKey: wc.githubAppPrivateKey, apiBaseUrl: wc.githubApiBaseUrl },
    installationId
  );

  // 3. Fetch diff and files in parallel
  const [diff, files] = await Promise.all([
    getPrDiff(installToken, owner, repoName, prNumber, wc.githubApiBaseUrl),
    getPrFiles(installToken, owner, repoName, prNumber, wc.githubApiBaseUrl),
  ]);

  // 4. Call AI gateway with agent context
  const gateway = new AIGatewayClient({
    baseUrl: `${wc.aiGatewayBaseUrl}/v1`,
    apiKey: wc.aiGatewayApiKey,
    model: wc.aiGatewayModel,
    reviewTone: 'balanced',
  });

  const reviewResult = await gateway.reviewDiff({
    diff,
    files: files.map(f => ({
      path: f.filename,
      status: f.status as 'added' | 'modified' | 'removed' | 'renamed',
    })),
    context: {
      repoFullName: repository.fullName,
      prNumber,
      agent: isAgent ? { isAgentAuthored: true, agentName: pullRequest?.agentName } : undefined,
    },
  });

  const { findings } = reviewResult;
  const scoreComposite = computeScore(findings);

  // Determine review action based on findings and mode
  const reviewAction = determineReviewAction(findings, scoreComposite, reviewMode);

  // 5. Resolve parent findings if this is a re-review
  const resolvedFindings: ReviewFindingRecord[] = [];
  if (parentFindings.length > 0) {
    const newFingerprints = new Set(findings.map(f => computeFindingFingerprint(f)));
    for (const pf of parentFindings) {
      if (pf.findingFingerprint && !newFingerprints.has(pf.findingFingerprint)) {
        await db.updateReviewFinding(pf.id, { status: 'resolved' });
        resolvedFindings.push(pf);
      }
    }
  }

  // 6. Write findings + update run
  if (reviewRunId) {
    try {
      await Promise.all(
        findings.map(finding =>
          db.addReviewFinding({
            reviewRunId,
            severity: finding.severity,
            title: finding.title,
            summary: finding.summary,
            suggestion: finding.suggestion,
            filePath: finding.filePath,
            line: finding.line,
            confidence: finding.confidence,
            status: 'open',
            findingFingerprint: computeFindingFingerprint(finding),
          })
        )
      );
      await db.updateReviewRun(reviewRunId, {
        status: 'completed',
        scoreComposite,
        findingsCount: findings.length,
        completedAt: nowIso(),
        reviewAction,
      });
    } catch (err) {
      await db.updateReviewRun(reviewRunId, {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: nowIso(),
      });
      throw err;
    }
  }

  // 7. Post PR review comments (only anchored findings)
  const anchoredComments: ReviewComment[] = findings
    .filter(f => f.filePath && typeof f.line === 'number')
    .map(f => {
      let body = `**[${f.severity.toUpperCase()}]** ${f.title}\n\n${f.summary}`;
      if (f.suggestion) {
        body += `\n\n**Suggested fix:**\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
      }
      return {
        path: f.filePath as string,
        line: f.line as number,
        body,
      };
    });

  const overallBody = buildOverallBody(
    findings,
    scoreComposite,
    reviewRunId,
    reviewAction,
    resolvedFindings.length > 0 ? resolvedFindings : undefined,
    reviewTier
  );
  const ghEvent: ReviewEvent = reviewAction;
  try {
    await postPrReview(
      installToken,
      owner,
      repoName,
      prNumber,
      headSha,
      anchoredComments,
      overallBody,
      wc.githubApiBaseUrl,
      ghEvent
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[worker-review] postPrReview failed pr=${prNumber}: ${msg}`);
    if (reviewRunId) {
      await db.updateReviewRun(reviewRunId, { errorMessage: `GitHub comment post failed: ${msg}` });
    }
  }

  console.log(
    `[worker-review] review completed repository=${repository.fullName} pr=${prNumber} ` +
      `findings=${findings.length} score=${scoreComposite.toFixed(2)} action=${reviewAction} mode=${reviewMode}`
  );
}

export async function handleJob(job: WorkerJob, config: HandlerConfig): Promise<void> {
  switch (job.kind) {
    case 'indexing':
      await handleIndexingJob(job, config);
      break;
    case 'review':
      await handleReviewJob(job, config);
      break;
    default: {
      const neverJob: never = job;
      throw new Error(`Unhandled job kind: ${String((neverJob as WorkerJob).kind)}`);
    }
  }
}
