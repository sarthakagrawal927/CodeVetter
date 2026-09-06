#!/usr/bin/env node
// Make MARKETING_VERSION the single source of truth for the shipped version.
//
// The version used to live in four hand-edited places: Shared.xcconfig, three
// crate manifests, the `=<version>` pins between those crates, and Cargo.lock.
// A cut that touched only Shared.xcconfig left the Rust companions behind, and
// that has now happened three times — 1.13.0 (fixed by hand in `72b6b60b`) and
// again in 1.13.4, where PR #266 bumped the xcconfig alone.
//
// The failure is worse than red CI. `core:qualify-cli` compares the built CLI's
// `--version` against MARKETING_VERSION, but it runs only in `ci.yml`, never in
// the release qualification path — a gap `72b6b60b` documented and left open.
// So a drifted cut can pass qualification and publish a signed, notarized app
// whose bundled `codevetter` and `codevetter-mcp` report the previous version.
//
// `--check` is the gate that closes that gap; the default mode is the writer
// that makes a version bump a one-line edit to Shared.xcconfig.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule } from './native-script-utils.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The crates that ship inside the app bundle and must move with it. */
export const syncedCrates = [
  'codevetter-core',
  'codevetter-transport',
  'codevetter-transport-macros',
];

const configPath = join(repositoryRoot, 'apps/macos/Config/Shared.xcconfig');
const lockPath = join(repositoryRoot, 'crates/codevetter-core/Cargo.lock');

const marketingVersionPattern = /^(MARKETING_VERSION\s*=\s*)(\S+)[^\S\n]*$/m;
const projectVersionPattern = /^(CURRENT_PROJECT_VERSION\s*=\s*)(\S+)[^\S\n]*$/m;
const semanticVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

export function readMarketingVersion(source) {
  const match = source.match(marketingVersionPattern);
  if (!match) throw new Error('Shared.xcconfig has no MARKETING_VERSION');
  const version = match[2];
  if (!semanticVersionPattern.test(version)) {
    throw new Error(`MARKETING_VERSION is not major.minor.patch: ${version}`);
  }
  return version;
}

/**
 * Xcode wants a monotonic integer build number. Every release since 1.11.1 has
 * encoded it as major*10000 + minor*100 + patch, so it is derived, not tracked.
 */
export function buildNumberFor(version) {
  const match = version.match(semanticVersionPattern);
  if (!match) throw new Error(`Not a major.minor.patch version: ${version}`);
  const [, major, minor, patch] = match.map(Number);
  if (minor > 99 || patch > 99) {
    throw new Error(`Version overflows the build-number encoding: ${version}`);
  }
  return String(major * 10000 + minor * 100 + patch);
}

export function applyProjectVersion(source, version) {
  if (!projectVersionPattern.test(source)) {
    throw new Error('Shared.xcconfig has no CURRENT_PROJECT_VERSION');
  }
  return source.replace(projectVersionPattern, `$1${buildNumberFor(version)}`);
}

/**
 * Rewrite the `[package]` version only. A crate manifest is full of unrelated
 * `version = "..."` keys (every dependency has one), so anchor on the section
 * header and stop at the next one.
 */
export function applyPackageVersion(manifest, version) {
  const section = /(^\[package\]\n(?:(?!^\[)[\s\S])*?^version\s*=\s*)"[^"]*"/m;
  if (!section.test(manifest)) throw new Error('Manifest has no [package] version');
  return manifest.replace(section, `$1"${version}"`);
}

/**
 * Rewrite the exact `=<version>` pins between our own crates. Keyed on the
 * sibling `path = "../codevetter-*"`, so third-party exact pins (rmcp, for one)
 * are left alone.
 */
export function applyWorkspacePins(manifest, version) {
  return manifest.replace(
    /\{[^{}\n]*path\s*=\s*"\.\.\/codevetter-[^"]*"[^{}\n]*\}/g,
    (dependency) => dependency.replace(/(version\s*=\s*)"=[^"]*"/, `$1"=${version}"`)
  );
}

/**
 * Rewrite the `[[package]]` blocks Cargo.lock keeps for our own crates. Every
 * transitive dependency has an identically shaped block, so match on the name.
 */
export function applyLockVersions(lockfile, version, crates = syncedCrates) {
  let updated = lockfile;
  for (const crate of crates) {
    const block = new RegExp(
      `(^\\[\\[package\\]\\]\\nname = "${crate}"\\nversion\\s*=\\s*)"[^"]*"`,
      'm'
    );
    if (!block.test(updated)) throw new Error(`Cargo.lock has no entry for ${crate}`);
    updated = updated.replace(block, `$1"${version}"`);
  }
  return updated;
}

function manifestPathFor(crate) {
  return join(repositoryRoot, 'crates', crate, 'Cargo.toml');
}

/**
 * Compute every file's desired content from MARKETING_VERSION. Pure against the
 * filesystem read, so `--check` and the writer cannot disagree about the target.
 */
export function planVersionSync({ config, manifests, lockfile }) {
  const version = readMarketingVersion(config);
  const files = [
    {
      path: configPath,
      label: 'apps/macos/Config/Shared.xcconfig',
      current: config,
      desired: applyProjectVersion(config, version),
    },
  ];
  for (const crate of syncedCrates) {
    const current = manifests[crate];
    files.push({
      path: manifestPathFor(crate),
      label: `crates/${crate}/Cargo.toml`,
      current,
      desired: applyWorkspacePins(applyPackageVersion(current, version), version),
    });
  }
  files.push({
    path: lockPath,
    label: 'crates/codevetter-core/Cargo.lock',
    current: lockfile,
    desired: applyLockVersions(lockfile, version),
  });

  return { version, files, drifted: files.filter((file) => file.current !== file.desired) };
}

function readRepository() {
  const manifests = {};
  for (const crate of syncedCrates) manifests[crate] = readFileSync(manifestPathFor(crate), 'utf8');
  return {
    config: readFileSync(configPath, 'utf8'),
    manifests,
    lockfile: readFileSync(lockPath, 'utf8'),
  };
}

export function syncNativeVersion({ check = false } = {}) {
  const plan = planVersionSync(readRepository());

  if (plan.drifted.length === 0) {
    process.stdout.write(`Version ${plan.version} is consistent across every shipped surface.\n`);
    return plan;
  }

  if (check) {
    process.stdout.write(
      `::error::MARKETING_VERSION is ${plan.version} but these files still carry an older ` +
        `version: ${plan.drifted.map((file) => file.label).join(', ')}. ` +
        `Run \`pnpm version:sync\` and commit the result.\n`
    );
    process.exitCode = 1;
    return plan;
  }

  for (const file of plan.drifted) writeFileSync(file.path, file.desired);
  process.stdout.write(
    `Synced ${plan.drifted.length} file(s) to ${plan.version}:\n` +
      plan.drifted.map((file) => `  ${file.label}\n`).join('')
  );
  return plan;
}

if (isMainModule(import.meta.url)) {
  try {
    syncNativeVersion({ check: process.argv.slice(2).includes('--check') });
  } catch (error) {
    process.stderr.write(`native version sync failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}
