'use strict'

/**
 * Fetch, verify and cache the Restorm build this machine needs.
 *
 * The contract every caller depends on: what this function returns is either a
 * complete, checksum-verified executable, or an exception. A half-written
 * download is never handed back and never left where a later run could mistake
 * it for a good one.
 */

const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')

const resolve = require('./resolve')

const COMPLETE_MARKER = '.complete'

/**
 * What a finished install left behind: the path, relative to the cache
 * directory, of the binary to run. Returns null when there is no completed
 * install here.
 *
 * 1.0.2 wrote the bare version string into this file and always ran the file
 * the manifest named. Such a cache is still valid — it just cannot say what to
 * execute, so the caller falls back to the manifest, exactly as that version
 * did. Re-downloading 400 MB to upgrade a marker format would be a poor trade.
 */
function readMarker(path, fallbackExec) {
  let raw
  try {
    raw = readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.exec === 'string') return parsed.exec
  } catch {
    /* the 1.0.2 format: a bare version string */
  }
  return fallbackExec
}

/**
 * Asks for this package's own version first, and falls back to the newest
 * release if that manifest is not there — which happens for exactly one reason
 * worth surviving: the npm package published before, or without, the matching
 * bucket upload.
 */
async function fetchManifest(env, platform, fetchImpl, version) {
  const call = fetchImpl || fetch
  const pinned = resolve.manifestUrl(env, platform, version)
  const res = await call(pinned, { redirect: 'follow' })
  if (res.ok) return await res.json()

  const newest = resolve.manifestUrl(env, platform, 'latest')
  if (res.status !== 404 || pinned === newest || env.RESTORM_VERSION) {
    throw new Error(`release manifest unavailable: HTTP ${res.status} for ${pinned}`)
  }
  const fallback = await call(newest, { redirect: 'follow' })
  if (!fallback.ok) {
    throw new Error(`release manifest unavailable: HTTP ${fallback.status} for ${newest}`)
  }
  return await fallback.json()
}

/**
 * Streams to disk while hashing, then compares. Hashing the stream rather than
 * re-reading the file afterwards keeps a 400 MB artifact off a second pass, and
 * — more importantly — leaves no window where the file on disk is not the file
 * that was verified.
 */
async function downloadVerified(url, dest, sha256, { fetchImpl, onProgress } = {}) {
  const res = await (fetchImpl || fetch)(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  const hash = createHash('sha256')
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  let done = 0
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) break
    const chunk = Buffer.from(value)
    hash.update(chunk)
    out.write(chunk)
    done += chunk.length
    if (onProgress) onProgress(done, total)
  }
  await new Promise((ok, ko) => out.end((e) => (e ? ko(e) : ok())))
  const actual = hash.digest('hex')
  if (actual !== sha256) {
    rmSync(dest, { force: true })
    throw new Error(
      `checksum mismatch for ${url}\n  expected ${sha256}\n  got      ${actual}\n` +
        'The download was discarded rather than executed.'
    )
  }
  return actual
}

/**
 * Unpack an AppImage into the cache and return the path, relative to the cache
 * directory, of what should actually be executed.
 *
 * An AppImage mounts itself with FUSE to run — and FUSE is exactly what a CI
 * runner does not have: Ubuntu stopped shipping `libfuse2` with 22.04, so every
 * GitHub-hosted Linux runner and every plain container answers `AppImages
 * require FUSE to run`. Unpacking it once, here, removes that dependency for
 * good: the extracted tree runs anywhere, and the cache is what makes paying
 * the extraction once acceptable.
 *
 * `--appimage-extract` is self-contained and needs no FUSE itself. If it fails
 * anyway, the image is kept and run directly — a machine with FUSE is no worse
 * off than before.
 */
function unpackAppImage(image, dir, fileName, log) {
  const r = spawnSync(image, ['--appimage-extract'], { cwd: dir, stdio: 'ignore' })
  const appRun = join(dir, 'squashfs-root', 'AppRun')
  if (r.error || r.status !== 0 || !existsSync(appRun)) {
    if (log) log('Could not unpack the AppImage — running the image itself (this needs FUSE).')
    return fileName
  }
  // The image is ~400 MB and nothing reads it once unpacked.
  rmSync(image, { force: true })
  return join('squashfs-root', 'AppRun')
}

function extractArchive(platform, archive, dir) {
  const candidates = resolve.extractCommands(platform, archive, dir)
  if (candidates.length === 0) throw new Error(`no extractor known for ${platform}`)
  let last = null
  for (const { cmd, args } of candidates) {
    const r = spawnSync(cmd, args, { stdio: 'inherit' })
    if (!r.error && r.status === 0) return cmd
    last = r.error ? r.error.message : `${cmd} exited ${r.status}`
  }
  throw new Error(`could not unpack ${archive}: ${last}`)
}

/**
 * Deletes every cached version but the one in use and the most recent other.
 * Never fatal: a cache we failed to tidy is a disk-space problem, not a reason
 * to refuse to run.
 */
function prune(root, keepVersion, log) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const versions = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      try {
        return { name: e.name, mtimeMs: statSync(join(root, e.name)).mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const victims = resolve.pruneVictims(versions, keepVersion)
  for (const name of victims) {
    try {
      rmSync(join(root, name), { recursive: true, force: true })
      if (log) log(`Removed cached build ${name}`)
    } catch {
      /* a build still running from this directory keeps it; try again next time */
    }
  }
  return victims
}

async function ensureBuild(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    arch = process.arch,
    home = homedir(),
    fetchImpl,
    log = () => {},
    onProgress,
    ownVersion = require('../package.json').version
  } = options

  const manifest = await fetchManifest(env, platform, fetchImpl, ownVersion)
  const version = manifest && manifest.version
  if (!version) throw new Error('the release manifest carries no version')

  const artifact = resolve.pickArtifact(manifest, platform, arch)
  if (!artifact) {
    throw new Error(`no Restorm build is published for ${platform}-${arch}`)
  }

  const root = resolve.cacheRoot(env, platform, home)
  const versionDir = join(root, version)
  const dir = join(versionDir, resolve.platformKey(platform, arch))

  // What to execute is decided at install time (an unpacked AppImage does not
  // run through the file the manifest names), so the marker records it rather
  // than leaving a later run to guess.
  const cachedExec = readMarker(join(dir, COMPLETE_MARKER), artifact.exec)
  if (cachedExec) {
    const exe = join(dir, cachedExec)
    if (existsSync(exe)) return { exe, version, cached: true }
  }

  let installedExec = artifact.exec

  // Everything below happens under a private staging directory, so two runs
  // racing on the same cache (two CI jobs on one machine) cannot see each
  // other's partial work. The loser of the race throws its copy away.
  const stage = join(root, `.staging-${process.pid}-${platform}-${arch}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  try {
    const archive = join(stage, artifact.file)
    log(`Fetching Restorm ${version} (${artifact.kind === 'appimage' ? 'AppImage' : 'archive'})…`)
    await downloadVerified(artifact.url, archive, artifact.sha256, { fetchImpl, onProgress })

    const payload = join(stage, 'payload')
    mkdirSync(payload, { recursive: true })
    let execPath = artifact.exec
    if (artifact.kind === 'appimage') {
      const image = join(payload, artifact.exec)
      renameSync(archive, image)
      chmodSync(image, 0o755)
      execPath = unpackAppImage(image, payload, artifact.exec, log)
    } else {
      extractArchive(platform, archive, payload)
      rmSync(archive, { force: true })
      const staged = join(payload, artifact.exec)
      if (!existsSync(staged)) {
        throw new Error(`the archive did not contain ${artifact.exec}`)
      }
      try {
        chmodSync(staged, 0o755)
      } catch {
        /* Windows has no execute bit */
      }
    }

    // The marker goes in before the directory is published, so the name a
    // later run tests for can only appear on a finished install.
    writeFileSync(join(payload, COMPLETE_MARKER), `${JSON.stringify({ version, exec: execPath })}\n`)
    mkdirSync(versionDir, { recursive: true })
    try {
      renameSync(payload, dir)
    } catch (e) {
      // Another process published the same version first — theirs is as good
      // as ours, and verified the same way. Their marker decides what runs.
      const theirs = readMarker(join(dir, COMPLETE_MARKER), artifact.exec)
      if (!theirs) throw e
      execPath = theirs
    }
    installedExec = execPath
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }

  prune(root, version, log)
  return { exe: join(dir, installedExec), version, cached: false }
}

module.exports = {
  COMPLETE_MARKER,
  downloadVerified,
  ensureBuild,
  extractArchive,
  fetchManifest,
  prune
}
