// Single source of release truth for /download, /download.md, and the CTAs.
//
// #253: the page hardcoded a version, a filename pattern, and an auto-update
// claim, and all three drifted from the release feed — it linked to releases
// that shipped nothing, documented `CodeVetter-<version>-arm64.dmg` while every
// published asset was `CodeVetter_<version>_aarch64.dmg`, and asserted Sparkle
// updates that no published release carried. Every claim below is now read from
// the release feed at build time, so the page can only say what is actually
// downloadable.

const REPOSITORY = 'Codevetter/codevetter';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

interface PublishedRelease {
  tag: string;
  url: string;
  /** Drag-to-Applications installer, always present: a release is chosen by it. */
  installer: string;
  /** Sparkle update archive, when the release publishes one. */
  updateArchive: string | null;
  /** Sparkle appcast, when the release publishes one. */
  appcastUrl: string | null;
}

interface FeedAsset {
  name: string;
  browser_download_url: string;
}

interface FeedRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: FeedAsset[];
}

/**
 * Newest published release that actually carries an installer. Returns `null`
 * when the feed is unreachable — an offline or rate-limited build falls back to
 * claiming nothing rather than to claiming something stale.
 */
async function resolvePublishedRelease(): Promise<PublishedRelease | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  let feed: FeedRelease[];
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`,
      {
        headers,
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    feed = (await response.json()) as FeedRelease[];
  } catch (error) {
    console.warn(`[release] download claims fall back to the releases index: ${error}`);
    return null;
  }

  for (const release of feed) {
    if (release.draft || release.prerelease) continue;
    const installer = release.assets.find((asset) => asset.name.endsWith('.dmg'));
    if (!installer) continue;
    return {
      tag: release.tag_name,
      url: release.html_url,
      installer: installer.name,
      updateArchive: release.assets.find((asset) => asset.name.endsWith('.zip'))?.name ?? null,
      appcastUrl:
        release.assets.find((asset) => asset.name === 'appcast.xml')?.browser_download_url ?? null,
    };
  }
  return null;
}

export const publishedRelease = await resolvePublishedRelease();

/** Where "Download" and "Latest release" point. Never a release with no build. */
export const currentReleaseUrl = publishedRelease?.url ?? RELEASES_URL;

/** A published feed proves update availability, not installed updater behavior. */
const signedUpdateFeedAvailable = Boolean(publishedRelease?.appcastUrl);

/** Installer filename claim. Only ever a name the release feed actually lists. */
export const installerLabel = publishedRelease
  ? publishedRelease.installer
  : 'the Apple-silicon macOS DMG attached to the newest release';

/** Update mechanism claim, shared verbatim by /download and /download.md. */
export const updateSummary = signedUpdateFeedAvailable
  ? 'A signed Sparkle update feed is available. In-app installation and relaunch are still being verified. To update manually, quit CodeVetter, download the latest DMG, and replace CodeVetter.app in Applications; keep your existing application data.'
  : 'Installed copies do not update themselves yet: no published release carries the signed Sparkle appcast the in-app updater requires, so update by downloading the newest release.';
