import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import {
  captureDataSnapshot,
  compareDataSnapshots,
  parseArguments,
} from './qualify-native-data-continuity.mjs';

async function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-data-continuity-'));
  const appData = join(root, 'com.codevetter.desktop');
  mkdirSync(appData);
  const database = join(appData, 'codevetter.db');
  execFileSync('/usr/bin/sqlite3', [
    database,
    `CREATE TABLE cc_projects(id TEXT PRIMARY KEY, display_name TEXT);
     CREATE TABLE cc_sessions(id TEXT PRIMARY KEY, project_id TEXT, first_message TEXT);
     CREATE TABLE local_reviews(id TEXT PRIMARY KEY, summary_markdown TEXT);
     CREATE TABLE preferences(key TEXT PRIMARY KEY, value TEXT);
     INSERT INTO cc_projects VALUES ('project-1', 'Private project');
     INSERT INTO cc_sessions VALUES ('session-1', 'project-1', 'private message');
     INSERT INTO local_reviews VALUES ('review-1', 'private review');
     INSERT INTO preferences VALUES ('github_token', 'secret-value');`,
  ]);
  try {
    return await run({ root, database });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('read-only snapshots preserve incumbent identities while allowing new rows', async () => {
  await withFixture(({ database }) => {
    const before = captureDataSnapshot({
      databasePath: database,
      phase: 'before',
      recordedAt: '2026-09-02T00:00:00.000Z',
      probeNonce: 'a'.repeat(64),
    });
    execFileSync('/usr/bin/sqlite3', [
      database,
      "INSERT INTO cc_sessions VALUES ('session-2', 'project-1', 'new private message');",
    ]);
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
      recordedAt: '2026-09-02T00:01:00.000Z',
    });
    execFileSync('/usr/bin/sqlite3', [database, "DELETE FROM cc_sessions WHERE id = 'session-2';"]);
    const afterRollback = captureDataSnapshot({
      databasePath: database,
      phase: 'after_rollback',
      baseline: before,
      recordedAt: '2026-09-02T00:02:00.000Z',
    });

    const continuity = compareDataSnapshots(before, afterUpgrade, afterRollback);
    assert.equal(continuity.schema_version, 'codevetter.native-data-continuity/v1');
    assert.equal(continuity.preserved_record_count, 4);
    assert.equal(continuity.before_sha256, continuity.after_upgrade_sha256);
    assert.equal(continuity.before_sha256, continuity.after_rollback_sha256);
    assert.equal(afterUpgrade.new_record_count, 1);
    assert.equal(JSON.stringify(before).includes('secret-value'), false);
    assert.equal(JSON.stringify(before).includes('private message'), false);
  });
});

function readRowCount(database) {
  try {
    return Number(
      execFileSync('/usr/bin/sqlite3', [database, 'SELECT count(*) FROM cc_projects;'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );
  } catch {
    return -1;
  }
}

// Commit through a connection that is killed rather than closed, so the -wal
// keeps a commit the main database file does not hold yet. A closing connection
// would checkpoint it away and delete both sidecars.
async function commitIntoAbandonedWal(database, sql, expectedRows) {
  const child = spawn('/usr/bin/sqlite3', [database], { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    child.stdin.write(`PRAGMA journal_mode=WAL;\n${sql}\n`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      // A second reader confirms the commit landed in the -wal. It never
      // checkpoints on close, because the writer above still holds the database.
      // It is locked out while the writer switches journal modes, so keep polling.
      const walBytes = statSync(`${database}-wal`, { throwIfNoEntry: false })?.size ?? 0;
      if (walBytes > 0 && readRowCount(database) === expectedRows) return;
      await setTimeout(20);
    }
    throw new Error('sqlite3 never committed into the -wal');
  } finally {
    child.kill('SIGKILL');
  }
}

// The shipped database runs in WAL mode and the upgrade harness terminates the
// app before every capture, so the probe meets it with whichever sidecars that
// shutdown happened to leave behind. A read-only connection cannot open a WAL
// database once a sidecar is missing — it fails with `unable to open database
// file (14)` before running a statement — which stopped six releases from ever
// reaching their upload job (#253). Every state below failed that way until the
// probe started reading a private copy instead.
for (const [state, removed] of [
  ['a clean shutdown removed both sidecars', ['-wal', '-shm']],
  ['a shutdown removed the -wal and left the -shm', ['-wal']],
  ['a kill left the -wal without its -shm', ['-shm']],
  ['a kill left both sidecars behind', []],
]) {
  test(`the WAL probe reads every committed record when ${state}`, async () => {
    await withFixture(async ({ database }) => {
      await commitIntoAbandonedWal(
        database,
        "INSERT INTO cc_projects VALUES ('project-2', 'Second project');",
        2
      );
      for (const suffix of removed) rmSync(`${database}${suffix}`, { force: true });

      const before = captureDataSnapshot({
        databasePath: database,
        phase: 'before',
        probeNonce: 'd'.repeat(64),
      });
      assert.equal(before.database_integrity, 'ok');
      // The WAL-resident row counts only when the sidecar carrying it survived.
      assert.equal(before.table_counts.cc_projects, removed.includes('-wal') ? 1 : 2);
      assert.equal(before.preserved_record_count, removed.includes('-wal') ? 4 : 5);
      assert.equal(JSON.stringify(before).includes('Second project'), false);
    });
  });
}

test('the probe leaves the application database and its sidecars untouched', async () => {
  await withFixture(async ({ database }) => {
    await commitIntoAbandonedWal(
      database,
      "INSERT INTO cc_projects VALUES ('project-2', 'Second project');",
      2
    );
    const digest = (path) =>
      existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
    const paths = ['', '-wal', '-shm'].map((suffix) => `${database}${suffix}`);
    const before = paths.map(digest);
    captureDataSnapshot({ databasePath: database, phase: 'before', probeNonce: 'e'.repeat(64) });
    assert.deepEqual(paths.map(digest), before);
  });
});

test('comparison fails when an incumbent record disappears', async () => {
  await withFixture(({ database }) => {
    const before = captureDataSnapshot({
      databasePath: database,
      phase: 'before',
      probeNonce: 'b'.repeat(64),
    });
    execFileSync('/usr/bin/sqlite3', [
      database,
      "DELETE FROM local_reviews WHERE id = 'review-1';",
    ]);
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
    });
    assert.equal(afterUpgrade.missing_record_count, 1);
    assert.throws(
      () => compareDataSnapshots(before, afterUpgrade, afterUpgrade),
      /after_upgrade does not preserve/
    );
  });
});

test('comparison refuses empty baseline evidence', async () => {
  const query = () => ({ integrity: 'ok', records: [], tableCounts: {} });
  await withFixture(({ database }) => {
    const before = captureDataSnapshot({
      databasePath: database,
      phase: 'before',
      probeNonce: 'c'.repeat(64),
      query,
    });
    const afterUpgrade = captureDataSnapshot({
      databasePath: database,
      phase: 'after_upgrade',
      baseline: before,
      query,
    });
    const afterRollback = captureDataSnapshot({
      databasePath: database,
      phase: 'after_rollback',
      baseline: before,
      query,
    });
    assert.throws(
      () => compareDataSnapshots(before, afterUpgrade, afterRollback),
      /at least one durable baseline record/
    );
  });
});

test('argument parsing keeps capture and comparison phases explicit', () => {
  const capture = parseArguments([
    'capture',
    '--database',
    '/tmp/codevetter.db',
    '--phase',
    'after_upgrade',
    '--baseline',
    '/tmp/before.json',
    '--out',
    '/tmp/after.json',
  ]);
  assert.equal(capture.phase, 'after_upgrade');
  assert.throws(
    () =>
      parseArguments([
        'capture',
        '--database',
        '/tmp/codevetter.db',
        '--phase',
        'after_upgrade',
        '--out',
        '/tmp/after.json',
      ]),
    /requires --baseline/
  );
  assert.doesNotThrow(() =>
    parseArguments([
      'compare',
      '--before',
      '/tmp/before.json',
      '--after-upgrade',
      '/tmp/upgrade.json',
      '--after-rollback',
      '/tmp/rollback.json',
      '--out',
      '/tmp/continuity.json',
    ])
  );
});
