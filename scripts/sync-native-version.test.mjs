import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLockVersions,
  applyPackageVersion,
  applyProjectVersion,
  applyWorkspacePins,
  buildNumberFor,
  planVersionSync,
  readMarketingVersion,
  syncedCrates,
} from './sync-native-version.mjs';

const config = ['MARKETING_VERSION = 1.13.4', 'CURRENT_PROJECT_VERSION = 11303', ''].join('\n');

// Shaped like the real manifest: a [package] version, an exact pin on a sibling
// crate, and third-party pins that must survive untouched.
const coreManifest = [
  '[package]',
  'name = "codevetter-core"',
  'version = "1.13.3"',
  '',
  '[dependencies]',
  'tauri = { package = "codevetter-transport", version = "=1.13.3", path = "../codevetter-transport" }',
  'serde = { version = "1", features = ["derive"] }',
  'rmcp = { version = "=2.2.0", default-features = false }',
  '',
].join('\n');

const lockfile = [
  '[[package]]',
  'name = "anyhow"',
  'version = "1.13.3"',
  '',
  '[[package]]',
  'name = "codevetter-core"',
  'version = "1.13.3"',
  'dependencies = [',
  ' "base64",',
  ']',
  '',
  '[[package]]',
  'name = "codevetter-transport"',
  'version = "1.13.3"',
  '',
  '[[package]]',
  'name = "codevetter-transport-macros"',
  'version = "1.13.3"',
  '',
].join('\n');

test('the marketing version is read from the xcconfig', () => {
  assert.equal(readMarketingVersion(config), '1.13.4');
});

test('a non-semver marketing version is rejected rather than propagated', () => {
  assert.throws(
    () => readMarketingVersion('MARKETING_VERSION = 1.13\n'),
    /not major\.minor\.patch/
  );
  assert.throws(() => readMarketingVersion('NAME = CodeVetter\n'), /no MARKETING_VERSION/);
});

test('the build number encodes major, minor, and patch', () => {
  assert.equal(buildNumberFor('1.13.4'), '11304');
  assert.equal(buildNumberFor('1.11.1'), '11101');
  assert.equal(buildNumberFor('1.12.0'), '11200');
  assert.equal(buildNumberFor('2.0.0'), '20000');
});

test('a version that would collide in the build-number encoding is rejected', () => {
  assert.throws(() => buildNumberFor('1.100.0'), /overflows/);
  assert.throws(() => buildNumberFor('1.0.100'), /overflows/);
});

test('the derived build number replaces a stale one', () => {
  assert.match(applyProjectVersion(config, '1.13.4'), /^CURRENT_PROJECT_VERSION = 11304$/m);
});

test('only the [package] version moves, not every dependency version', () => {
  const updated = applyPackageVersion(coreManifest, '1.13.4');
  assert.match(updated, /^\[package\]\nname = "codevetter-core"\nversion = "1\.13\.4"$/m);
  assert.match(updated, /serde = \{ version = "1"/);
  assert.match(updated, /rmcp = \{ version = "=2\.2\.0"/);
});

test('exact pins on our own crates move; third-party exact pins do not', () => {
  const updated = applyWorkspacePins(coreManifest, '1.13.4');
  assert.match(updated, /package = "codevetter-transport", version = "=1\.13\.4"/);
  assert.match(updated, /rmcp = \{ version = "=2\.2\.0"/);
});

test('the lockfile moves our crates and leaves identically versioned strangers alone', () => {
  const updated = applyLockVersions(lockfile, '1.13.4');
  for (const crate of syncedCrates) {
    assert.match(updated, new RegExp(`name = "${crate}"\\nversion = "1\\.13\\.4"`));
  }
  assert.match(updated, /name = "anyhow"\nversion = "1\.13\.3"/);
});

test('a crate missing from the lockfile fails closed instead of silently skipping', () => {
  assert.throws(
    () => applyLockVersions('[[package]]\nname = "anyhow"\nversion = "1"\n', '1.13.4'),
    /no entry for codevetter-core/
  );
});

function repository(overrides = {}) {
  return {
    config,
    manifests: Object.fromEntries(syncedCrates.map((crate) => [crate, coreManifest])),
    lockfile,
    ...overrides,
  };
}

test('the plan reports every drifted file when only the xcconfig was bumped', () => {
  const plan = planVersionSync(repository());
  assert.equal(plan.version, '1.13.4');
  assert.deepEqual(plan.drifted.map((file) => file.label).sort(), [
    'apps/macos/Config/Shared.xcconfig',
    'crates/codevetter-core/Cargo.lock',
    'crates/codevetter-core/Cargo.toml',
    'crates/codevetter-transport-macros/Cargo.toml',
    'crates/codevetter-transport/Cargo.toml',
  ]);
});

test('an already-synced repository reports no drift', () => {
  const synced = planVersionSync(repository());
  const settled = planVersionSync({
    config: synced.files[0].desired,
    manifests: Object.fromEntries(
      syncedCrates.map((crate) => [
        crate,
        synced.files.find((file) => file.label === `crates/${crate}/Cargo.toml`).desired,
      ])
    ),
    lockfile: synced.files.at(-1).desired,
  });
  assert.deepEqual(settled.drifted, []);
});

test('the plan is idempotent: syncing twice changes nothing the second time', () => {
  const once = planVersionSync(repository());
  const twice = planVersionSync({
    config: once.files[0].desired,
    manifests: Object.fromEntries(
      syncedCrates.map((crate) => [
        crate,
        once.files.find((file) => file.label === `crates/${crate}/Cargo.toml`).desired,
      ])
    ),
    lockfile: once.files.at(-1).desired,
  });
  assert.equal(twice.drifted.length, 0);
  assert.equal(twice.version, once.version);
});
