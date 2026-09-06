import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateReleaseManifest,
  parseArguments,
  releaseAssetContract,
  versionFromTag,
} from './verify-release-manifest.mjs';

const tag = 'v1.13.3';
const contract = releaseAssetContract('1.13.3');

function asset(name, overrides = {}) {
  return { name, size: 4096, state: 'uploaded', ...overrides };
}

function completeManifest(overrides = {}) {
  return {
    tag,
    assets: [
      asset(contract.installer),
      asset(contract.updateArchive),
      asset(contract.appcast, { size: 1024 }),
    ],
    ...overrides,
  };
}

function blockers(manifest) {
  return evaluateReleaseManifest(manifest).blockers;
}

test('a complete manifest qualifies', () => {
  const receipt = evaluateReleaseManifest(completeManifest());
  assert.equal(receipt.status, 'qualified');
  assert.equal(receipt.qualified, true);
  assert.deepEqual(receipt.blockers, []);
  assert.deepEqual(receipt.missing, []);
  assert.deepEqual(receipt.unexpected, []);
  assert.equal(receipt.version, '1.13.3');
});

test('a draft release still qualifies on its assets alone', () => {
  // The build uploads into the draft and only then publishes it, so draft
  // state must never be a blocker — it is recorded, not judged.
  const receipt = evaluateReleaseManifest(completeManifest({ draft: true }));
  assert.equal(receipt.qualified, true);
  assert.equal(receipt.draft, true);
});

test('a missing asset blocks and names what is absent', () => {
  const manifest = completeManifest();
  manifest.assets = manifest.assets.filter((item) => item.name !== contract.updateArchive);
  const receipt = evaluateReleaseManifest(manifest);
  assert.equal(receipt.qualified, false);
  assert.deepEqual(receipt.missing, [contract.updateArchive]);
  assert.deepEqual(receipt.blockers, ['update_archive_published', 'assets_uploaded']);
});

test('a release with no assets at all blocks — the #253 regression', () => {
  const receipt = evaluateReleaseManifest({ tag, assets: [] });
  assert.equal(receipt.qualified, false);
  assert.deepEqual(receipt.missing, Object.values(contract));
  assert.deepEqual(receipt.blockers, [
    'installer_published',
    'update_archive_published',
    'appcast_published',
    'assets_uploaded',
  ]);
});

test('Tauri-shaped filenames block instead of passing as the native contract', () => {
  // Every asset ever published is `CodeVetter_<version>_aarch64.dmg`, which the
  // download page documented as `CodeVetter-<version>-arm64.dmg`.
  const receipt = evaluateReleaseManifest({
    tag: 'v1.11.1',
    assets: [
      asset('CodeVetter_1.11.1_aarch64.dmg'),
      asset('CodeVetter_aarch64.app.tar.gz'),
      asset('CodeVetter.app.tar.gz.sig'),
      asset('latest.json'),
    ],
  });
  assert.equal(receipt.qualified, false);
  assert.deepEqual(receipt.missing, Object.values(releaseAssetContract('1.11.1')));
  assert.deepEqual(receipt.unexpected, [
    'CodeVetter_1.11.1_aarch64.dmg',
    'CodeVetter_aarch64.app.tar.gz',
    'CodeVetter.app.tar.gz.sig',
    'latest.json',
  ]);
  assert.ok(receipt.blockers.includes('assets_on_contract'));
});

test('an asset for the wrong version blocks', () => {
  const manifest = completeManifest();
  manifest.assets[0] = asset('CodeVetter-1.13.2-arm64.dmg');
  const receipt = evaluateReleaseManifest(manifest);
  assert.equal(receipt.qualified, false);
  assert.deepEqual(receipt.missing, [contract.installer]);
  assert.deepEqual(receipt.unexpected, ['CodeVetter-1.13.2-arm64.dmg']);
});

test('an asset that is still uploading or empty blocks', () => {
  assert.deepEqual(
    blockers(
      completeManifest({
        assets: [
          asset(contract.installer, { state: 'starter' }),
          asset(contract.updateArchive),
          asset(contract.appcast),
        ],
      })
    ),
    ['assets_uploaded']
  );
  assert.deepEqual(
    blockers(
      completeManifest({
        assets: [
          asset(contract.installer),
          asset(contract.updateArchive, { size: 0 }),
          asset(contract.appcast),
        ],
      })
    ),
    ['assets_uploaded']
  );
});

test('a tag that is not v<semver> blocks before any asset is judged', () => {
  const receipt = evaluateReleaseManifest({ tag: 'release-1.13.3', assets: [] });
  assert.equal(receipt.version, null);
  assert.deepEqual(receipt.expected, []);
  assert.ok(receipt.blockers.includes('tag_version'));
});

test('versionFromTag accepts prereleases and rejects anything else', () => {
  assert.equal(versionFromTag('v1.13.3'), '1.13.3');
  assert.equal(versionFromTag('v1.13.3-rc.1'), '1.13.3-rc.1');
  assert.equal(versionFromTag('1.13.3'), null);
  assert.equal(versionFromTag(undefined), null);
});

test('arguments resolve the tag, repository, manifest, and receipt path', () => {
  const options = parseArguments([
    '--tag',
    tag,
    '--repo',
    'Codevetter/codevetter',
    '--manifest',
    'fixture.json',
    '--out',
    'artifacts/receipt.json',
  ]);
  assert.deepEqual(options, {
    tag,
    repository: 'Codevetter/codevetter',
    manifest: 'fixture.json',
    out: 'artifacts/receipt.json',
  });
  assert.throws(() => parseArguments([]), /--tag is required/);
  assert.throws(() => parseArguments(['--tag']), /--tag requires a value/);
  assert.throws(() => parseArguments(['--nope', 'x']), /Unknown argument/);
});
