'use strict'

/**
 * Pure resolution helpers for the launcher: where the cache lives, which
 * artifact this machine needs, how to unpack it. No I/O happens here, so every
 * rule below is testable on any platform regardless of the one it describes.
 */

const { join } = require('node:path')

const DEFAULT_BASE = 'https://dl.restorm.app'

/**
 * Where the runnable binary sits once the artifact is unpacked. The manifest
 * carries this per platform; these are the fallbacks for a manifest written
 * before the field existed.
 */
const EXEC_BY_PLATFORM = {
  linux: 'Restorm.AppImage',
  darwin: 'Restorm.app/Contents/MacOS/Restorm',
  win32: 'Restorm.exe'
}

function platformKey(platform, arch) {
  return `${platform}-${arch}`
}

function downloadBase(env) {
  return String(env.RESTORM_DL_BASE || DEFAULT_BASE).replace(/\/+$/, '')
}

/**
 * One manifest per platform rather than a single merged one: the release
 * workflow publishes from inside its build matrix, so no job ever holds all
 * three platforms' artifacts at once. A per-platform file lets each job write
 * its own without coordinating with the others.
 *
 * The version asked for is THIS package's own, because the two are published
 * together and always match. It matters in CI: `restorm-cli@1.0.2` must run
 * Restorm 1.0.2 six months from now, not whatever shipped since — a pinned
 * dependency that silently follows a moving target is not pinned at all.
 * `RESTORM_VERSION` overrides it, and `RESTORM_VERSION=latest` opts back into
 * the newest release.
 */
function manifestUrl(env, platform, version) {
  const base = downloadBase(env)
  const want = env.RESTORM_VERSION || version
  if (!want || want === 'latest' || String(want).startsWith('0.0.0')) {
    return `${base}/latest/manifest-${platform}.json`
  }
  return `${base}/v${want}/manifest-${platform}.json`
}

/**
 * The per-user cache. Each OS has a directory the system already understands as
 * "regenerable data" — a cleaner may empty it, and the next run simply
 * downloads again.
 */
function cacheRoot(env, platform, home) {
  if (env.RESTORM_CACHE_DIR) return env.RESTORM_CACHE_DIR
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'restorm', 'Cache')
  }
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'restorm')
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'restorm')
}

function pickArtifact(manifest, platform, arch) {
  const key = platformKey(platform, arch)
  const entry = manifest && manifest.artifacts && manifest.artifacts[key]
  if (!entry) return null
  if (!entry.url || !entry.sha256) {
    throw new Error(`the release manifest's ${key} entry has no url or no sha256`)
  }
  return {
    kind: entry.kind || 'zip',
    url: entry.url,
    sha256: String(entry.sha256).toLowerCase(),
    size: Number(entry.size) || 0,
    file: entry.file || entry.url.split('/').pop(),
    exec: entry.exec || EXEC_BY_PLATFORM[platform]
  }
}

/**
 * Unpacking is delegated to a tool every supported OS ships with, so the
 * package keeps its zero dependencies.
 *
 * macOS gets `ditto` rather than `unzip`: a `.app` is a tree of symlinks and
 * extended attributes, and ditto is the only extractor Apple guarantees will
 * reproduce it faithfully. Windows gets bsdtar (`tar` since Windows 10), which
 * reads zip and is an order of magnitude faster than Expand-Archive on a
 * 400 MB archive — the fallback exists for older images.
 */
function extractCommands(platform, archive, dir) {
  if (platform === 'darwin') {
    return [
      { cmd: 'ditto', args: ['-x', '-k', archive, dir] },
      { cmd: 'unzip', args: ['-q', archive, '-d', dir] }
    ]
  }
  if (platform === 'win32') {
    return [
      { cmd: 'tar', args: ['-xf', archive, '-C', dir] },
      {
        cmd: 'powershell',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath ${JSON.stringify(archive)} -DestinationPath ${JSON.stringify(dir)} -Force`
        ]
      }
    ]
  }
  return []
}

/**
 * Which cached versions to delete once `keepVersion` is in place. Keeping one
 * previous version costs disk but saves the whole download when a machine
 * alternates between a released and a preview build, or when a release is
 * rolled back.
 */
function pruneVictims(versions, keepVersion, keep = 2) {
  return versions
    .filter((v) => v.name !== keepVersion)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(Math.max(0, keep - 1))
    .map((v) => v.name)
}

module.exports = {
  DEFAULT_BASE,
  EXEC_BY_PLATFORM,
  cacheRoot,
  downloadBase,
  extractCommands,
  manifestUrl,
  pickArtifact,
  platformKey,
  pruneVictims
}
