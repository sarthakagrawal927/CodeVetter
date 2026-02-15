import * as core from '@actions/core';
import { GitHubClient, ReviewCommentInput } from './github';

type DiffLine = {
  line: number;
  side: 'LEFT' | 'RIGHT';
  text: string;
};

const MAX_COMMENTS_PER_REVIEW = 40;
const MAX_LINE_PREVIEW_LENGTH = 160;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function extractChangedLinesFromPatch(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  const changedLines: DiffLine[] = [];

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!hunkMatch) {
        inHunk = false;
        continue;
      }

      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      inHunk = true;
      continue;
    }

    if (!inHunk) {
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      changedLines.push({
        line: newLine,
        side: 'RIGHT',
        text: line.slice(1)
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      changedLines.push({
        line: oldLine,
        side: 'LEFT',
        text: line.slice(1)
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith('\\')) {
      continue;
    }
  }

  return changedLines;
}

function buildReviewComment(
  path: string,
  change: DiffLine,
  index: number,
  total: number
): ReviewCommentInput {
  const changeType = change.side === 'RIGHT' ? 'added' : 'removed';
  const cleanText = change.text.trim().length > 0 ? change.text.trim() : '(blank line)';
  const preview = truncate(cleanText, MAX_LINE_PREVIEW_LENGTH);

  return {
    path,
    line: change.line,
    side: change.side,
    body: `Test change ${index}/${total} (${changeType} line): ${preview}`
  };
}

async function run() {
  try {
    const githubToken = core.getInput('github_token');

    const githubClient = new GitHubClient(githubToken);

    core.info('Fetching PR files...');
    const files = await githubClient.getPRFiles();

    if (files.length === 0) {
      core.info('No files found in PR.');
      return;
    }

    const collectedChanges: Array<{ path: string; change: DiffLine }> = [];

    for (const file of files) {
      if (!file.patch) {
        core.info(`Skipping ${file.filename} (no patch available).`);
        continue;
      }

      const fileChanges = extractChangedLinesFromPatch(file.patch);
      core.info(`Found ${fileChanges.length} changed lines in ${file.filename}.`);

      for (const change of fileChanges) {
        collectedChanges.push({ path: file.filename, change });
      }
    }

    if (collectedChanges.length === 0) {
      core.info('No inline-commentable changed lines found.');
      await githubClient.postComment('No inline-commentable changes found in this PR for testing.');
      return;
    }

    const comments = collectedChanges.map(({ path, change }, idx) =>
      buildReviewComment(path, change, idx + 1, collectedChanges.length)
    );

    core.info(`Posting ${comments.length} inline comments in batches...`);
    let postedComments = 0;
    for (let i = 0; i < comments.length; i += MAX_COMMENTS_PER_REVIEW) {
      const batch = comments.slice(i, i + MAX_COMMENTS_PER_REVIEW);
      const batchNumber = Math.floor(i / MAX_COMMENTS_PER_REVIEW) + 1;
      core.info(`Posting batch ${batchNumber} (${batch.length} comments).`);

      try {
        await githubClient.createReviewComments(batch);
        postedComments += batch.length;
      } catch (error) {
        core.warning(`Batch ${batchNumber} failed, retrying comment-by-comment: ${String(error)}`);

        for (const comment of batch) {
          try {
            await githubClient.createReviewComments([comment]);
            postedComments += 1;
          } catch (singleCommentError) {
            core.warning(
              `Skipping ${comment.path}:${comment.line} (${comment.side}) due to error: ${String(singleCommentError)}`
            );
          }
        }
      }
    }

    if (postedComments === 0) {
      await githubClient.postComment('Failed to post inline test comments for this PR.');
      throw new Error('All inline comments failed to post.');
    }

    if (postedComments < comments.length) {
      await githubClient.postComment(
        `Posted ${postedComments}/${comments.length} inline test comments. Some comments were skipped due to API validation errors.`
      );
    }

    core.info('Review completed successfully.');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run();
