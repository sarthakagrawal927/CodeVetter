#!/usr/bin/env node
// Verify that a GitHub Release carries the exact native asset contract.
//
// This is the gate that #253 found missing: `auto-release.yml` used to create a
// release before any build ran and never waited, so six consecutive releases
// published zero assets while every run reported success. The release is now a
// draft until this receipt qualifies it.
//
// Cryptographic appcast inspection is a separate, offline gate
// (`scripts/inspect-native-appcast.mjs`). This script only asserts the
// published manifest: the three contract assets exist, are uploaded, are
// non-empty, and nothing off-contract is attached under a misleading name.

import { writeFileSync } from 'node:fs';

import { isMainModule, readJSON } from './native-script-utils.mjs';

const schemaVersion = 'codevetter.release-manifest-verification/v1';
const defaultRepository = 'Codevetter/codevetter';

/** The exact asset names a qualified native release publishes. */
export function releaseAssetContract(version) {
  return {
    installer: `CodeVetter-${version}-arm64.dmg`,
    updateArchive: `CodeVetter-${version}-arm64.zip`,
    appcast: 'appcast.xml',
  };
}

export function versionFromTag(tag) {
  return /^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag ?? '') ? tag.slice(1) : null;
}

export function parseArguments(argv) {
  const options = { repository: process.env.GITHUB_REPOSITORY || defaultRepository };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--tag') options.tag = value;
    else if (argument === '--repo') options.repository = value;
    else if (argument === '--manifest') options.manifest = value;
    else if (argument === '--out') options.out = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.tag) throw new Error('--tag is required');
  return options;
}

/**
 * Pure manifest evaluation. `assets` is the GitHub release asset array
 * (`[{ name, size, state }]`); everything else is derived from the tag.
 */
export function evaluateReleaseManifest({ tag, assets = [], draft = false }) {
  const version = versionFromTag(tag);
  const contract = version ? releaseAssetContract(version) : null;
  const expected = contract ? Object.values(contract) : [];
  const published = assets.map((asset) => asset?.name).filter((name) => typeof name === 'string');
  const unexpected = published.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !published.includes(name));
  const unusable = expected
    .map((name) => assets.find((asset) => asset?.name === name))
    .filter((asset) => asset && !(asset.state === 'uploaded' && Number(asset.size) > 0))
    .map((asset) => asset.name);

  const checks = [
    check('tag_version', Boolean(version), version ?? `${tag} is not v<semver>`),
    check(
      'installer_published',
      Boolean(contract) && published.includes(contract.installer),
      contract?.installer ?? 'unknown'
    ),
    check(
      'update_archive_published',
      Boolean(contract) && published.includes(contract.updateArchive),
      contract?.updateArchive ?? 'unknown'
    ),
    check(
      'appcast_published',
      Boolean(contract) && published.includes(contract.appcast),
      contract?.appcast ?? 'unknown'
    ),
    check(
      'assets_uploaded',
      missing.length === 0 && unusable.length === 0,
      unusable.length === 0
        ? `${expected.length - missing.length}/${expected.length}`
        : unusable.join(', ')
    ),
    check(
      'assets_on_contract',
      unexpected.length === 0,
      unexpected.length === 0 ? 'none off-contract' : unexpected.join(', ')
    ),
  ];
  const blockers = checks.filter((item) => !item.passed).map((item) => item.id);
  return {
    schema_version: schemaVersion,
    authority: 'published_release_manifest',
    status: blockers.length === 0 ? 'qualified' : 'blocked',
    qualified: blockers.length === 0,
    tag,
    version,
    draft,
    expected,
    published,
    missing,
    unexpected,
    checks,
    blockers,
  };
}

async function fetchRelease(repository, tag) {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${repository}`;

  const direct = await fetch(`${base}/releases/tags/${encodeURIComponent(tag)}`, { headers });
  if (direct.ok) return direct.json();
  if (direct.status !== 404) {
    throw new Error(`GitHub returned HTTP ${direct.status} for ${repository}@${tag}`);
  }

  // Draft releases are invisible to the by-tag endpoint; they only appear in
  // the authenticated list. A draft is the normal state while the build runs.
  const listed = await fetch(`${base}/releases?per_page=100`, { headers });
  if (!listed.ok) throw new Error(`GitHub returned HTTP ${listed.status} listing ${repository}`);
  const release = (await listed.json()).find((item) => item?.tag_name === tag);
  if (!release) throw new Error(`No release is tagged ${tag} in ${repository}`);
  return release;
}

export async function verifyReleaseManifest(options = parseArguments(process.argv.slice(2))) {
  const release = options.manifest
    ? readJSON(options.manifest)
    : await fetchRelease(options.repository, options.tag);
  const receipt = evaluateReleaseManifest({
    tag: options.tag,
    assets: release.assets ?? [],
    draft: release.draft === true,
  });
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.out) writeFileSync(options.out, output);
  process.stdout.write(output);
  if (!receipt.qualified) {
    process.stdout.write(
      `::error::${options.tag} does not satisfy the release asset contract: ${receipt.blockers.join(', ')}\n`
    );
    process.exitCode = 1;
  }
  return receipt;
}

function check(id, passed, detail) {
  return { id, passed: passed === true, detail };
}

if (isMainModule(import.meta.url)) {
  verifyReleaseManifest().catch((error) => {
    process.stderr.write(`release manifest verification failed: ${error.message}\n`);
    process.exitCode = 2;
  });
}
