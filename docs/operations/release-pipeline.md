---
title: Release pipeline
description: How a native version bump becomes a signed and notarized GitHub Release.
sidebar:
  order: 1
---

# Release pipeline

CodeVetter ships one native macOS application through GitHub Releases. Sparkle
consumes the release's signed `appcast.xml`.

## Chain

```text
apps/macos/Config/Shared.xcconfig version changes on main
  -> auto-release.yml creates the v<version> tag and a DRAFT release,
     dispatches release.yml, and waits for that run
  -> release.yml calls native-production-qualification.yml at that exact tag
  -> Xcode Release build + Rust/ccusage companions
  -> Developer ID signing + hardened runtime + notarization + stapling
  -> isolated incumbent-to-native upgrade, relaunch, data, and rollback proof
  -> Sparkle archive and EdDSA appcast verification
  -> DMG, ZIP, and appcast.xml uploaded to the draft GitHub Release
  -> verify-release-manifest.mjs qualifies the published manifest
  -> the draft is flipped to published and marked latest
  -> auto-release re-verifies the manifest before it reports success
```

The explicit dispatch is required because a release created with GitHub's
workflow token does not recursively trigger another workflow. Both auto-release
and release jobs are idempotent for an existing tag.

## Asset gate

The release is a **draft** for the whole of the build. A draft is absent from
`/releases/latest`, from the release feed the download page reads, and from
Sparkle's update feed, so a failed build leaves nothing user-visible behind.

`scripts/verify-release-manifest.mjs --tag v<version>` is the required gate that
flips it. It fails the run when any contract asset is missing, empty, still
uploading, or attached under a name that is not on the contract, and it runs
twice: in `release.yml` before the draft is published, and again in
`auto-release.yml` after the watched build finishes. A green `auto-release.yml`
run therefore means a downloadable release exists.

This gate did not exist before #253. `auto-release.yml` created the release
before any build ran and exited without waiting, so six consecutive releases
(`v1.12.0` through `v1.13.2`) went public with zero assets while all eight runs
reported success. `verify-release-manifest.mjs` was referenced by no workflow
and no package script.

## Required production gates

- the tag equals `MARKETING_VERSION` in `Shared.xcconfig`;
- the app and every executable companion use the production identity/version;
- Developer ID signatures, one Team ID, Hardened Runtime, and Library
  Validation pass;
- Apple's notarization accepts the final archive and the app carries a valid
  stapled ticket;
- the Sparkle appcast is HTTPS, EdDSA-signed, and bound to the exact qualified
  archive;
- the isolated installed-upgrade proof preserves durable local data across
  native relaunch and incumbent rollback;
- `release-readiness.json` reports every check passed and
  `shipping_ready: true`.

Credentials are required only inside the protected ephemeral runner. They are
never printed, persisted in artifacts, or used by local read-only preflight.

## Migration incumbent

The installed-upgrade proof needs a prior *Tauri* build to upgrade from, pinned
in `native-production-qualification.yml`. That incumbent has to satisfy two
constraints at once:

1. it still carries `CodeVetter_aarch64.app.tar.gz` — only Tauri releases do,
   and `v1.11.1` is the newest tag with any assets at all; and
2. its bundled `codevetter` CLI understands `rubrics`, because that is how the
   proof seeds the durable record whose survival across upgrade and rollback is
   the thing being proven.

The pin is **`v1.11.1`**. It was `v1.11.0`, which fails the second constraint:
that CLI predates `rubrics` and exposes only `check` and `trex`, so the gate
could never pass and no release published assets (#252). `rubrics` landed in
`44390309` (2026-09-02), one day before `v1.11.1` was tagged.

Only a Tauri release can serve here, so this pin cannot advance past `v1.11.1`.
When cross-shell migration stops being worth proving, narrow the proof to data
the candidate writes itself rather than repointing the pin.

## Assets

Exactly these three, and nothing else:

- `CodeVetter-<version>-arm64.dmg`
- `CodeVetter-<version>-arm64.zip`
- `appcast.xml`

No release has yet published assets under these names — every published asset
is still Tauri-shaped (`CodeVetter_<version>_aarch64.dmg`), and `v1.11.1` is
the newest release carrying any. The download page therefore states the
filename, tag, and update mechanism it reads from the release feed at build
time rather than this contract; it will name these files as soon as a release
publishes them. See `apps/landing-page-astro/src/data/release.ts`.

## Key files

- `.github/workflows/auto-release.yml`
- `.github/workflows/release.yml`
- `.github/workflows/native-production-qualification.yml`
- `apps/macos/Config/Shared.xcconfig`
- `scripts/qualify-native-package.mjs`
- `scripts/inspect-native-release-readiness.mjs`
- `scripts/verify-release-manifest.mjs`
- [runbooks/cut-a-release.md](./runbooks/cut-a-release.md)
