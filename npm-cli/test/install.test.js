'use strict'

/**
 * Exercises the real download path against a local HTTP server: the artifact is
 * fetched, checksummed, cached, and the second run does not touch the network.
 * The fake artifact is a one-line script, so the test proves the caching and
 * verification rules without moving 400 MB.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createHash } = require('node:crypto')
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { ensureBuild, prune } = require('../lib/install')

/**
 * A stand-in for the AppImage, honouring the one part of its contract the
 * launcher depends on: `--appimage-extract` unpacks a `squashfs-root/AppRun`
 * next to the caller's working directory, without needing FUSE.
 */
const PAYLOAD = [
  '#!/bin/sh',
  'if [ "$1" = "--appimage-extract" ]; then',
  '  mkdir -p squashfs-root',
  '  printf "#!/bin/sh\\necho restorm-apprun\\n" > squashfs-root/AppRun',
  '  chmod +x squashfs-root/AppRun',
  '  exit 0',
  'fi',
  'echo restorm-stub',
  ''
].join('\n')

const UNEXTRACTABLE = '#!/bin/sh\nexit 3\n'
const SHA = createHash('sha256').update(PAYLOAD).digest('hex')

function startServer({ sha = SHA, version = '9.9.9', payload = PAYLOAD } = {}) {
  const hits = { manifest: 0, artifact: 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/latest/manifest-linux.json') {
      hits.manifest += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          version,
          artifacts: {
            'linux-x64': {
              kind: 'appimage',
              file: `Restorm-${version}.AppImage`,
              url: `${base(server)}/v${version}/Restorm-${version}.AppImage`,
              sha256: sha,
              size: payload.length,
              exec: 'Restorm.AppImage'
            }
          }
        })
      )
      return
    }
    if (req.url.endsWith('.AppImage')) {
      hits.artifact += 1
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length })
      res.end(payload)
      return
    }
    res.writeHead(404).end('nope')
  })
  return { server, hits }
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`
}

async function withServer(opts, fn) {
  const { server, hits } = startServer(opts)
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const cache = mkdtempSync(join(tmpdir(), 'restorm-cache-'))
  try {
    return await fn({ env: { RESTORM_DL_BASE: base(server), RESTORM_CACHE_DIR: cache }, cache, hits })
  } finally {
    server.close()
    rmSync(cache, { recursive: true, force: true })
  }
}

const linux = (env) => ({ env, platform: 'linux', arch: 'x64', home: '/nonexistent' })

test('a first run downloads, verifies and caches; a second run downloads nothing', async () => {
  await withServer({}, async ({ env, cache, hits }) => {
    const first = await ensureBuild(linux(env))
    assert.equal(first.cached, false)
    assert.equal(first.version, '9.9.9')
    assert.equal(
      first.exe,
      join(cache, '9.9.9', 'linux-x64', 'squashfs-root', 'AppRun'),
      'the AppImage is unpacked, so running it needs no FUSE'
    )
    assert.ok(statSync(first.exe).mode & 0o111, 'and what we hand back is executable')
    assert.equal(
      existsSync(join(cache, '9.9.9', 'linux-x64', 'Restorm.AppImage')),
      false,
      'the 400 MB image is dropped once unpacked — nothing reads it again'
    )
    assert.equal(hits.artifact, 1)

    const second = await ensureBuild(linux(env))
    assert.equal(second.cached, true)
    assert.equal(second.exe, first.exe)
    assert.equal(hits.artifact, 1, 'the cached build is reused instead of re-downloaded')
  })
})

test('an AppImage that refuses to unpack is still run directly', async () => {
  // A machine with FUSE loses nothing when unpacking fails; refusing to run at
  // all would turn a slower path into no path.
  const sha = createHash('sha256').update(UNEXTRACTABLE).digest('hex')
  await withServer({ sha, payload: UNEXTRACTABLE }, async ({ env, cache }) => {
    const built = await ensureBuild(linux(env))
    assert.equal(built.exe, join(cache, '9.9.9', 'linux-x64', 'Restorm.AppImage'))
    assert.equal(readFileSync(built.exe, 'utf8'), UNEXTRACTABLE, 'the image itself is kept')

    const again = await ensureBuild(linux(env))
    assert.equal(again.cached, true)
    assert.equal(again.exe, built.exe, 'and the cache remembers what to run')
  })
})

test('a cache written by 1.0.2 is honoured, not re-downloaded', async () => {
  // 1.0.2 wrote the bare version into the marker and ran the file the manifest
  // named. Discarding such a cache would cost every one of those users 400 MB.
  await withServer({}, async ({ env, cache, hits }) => {
    const dir = join(cache, '9.9.9', 'linux-x64')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Restorm.AppImage'), PAYLOAD)
    writeFileSync(join(dir, '.complete'), '9.9.9\n')

    const built = await ensureBuild(linux(env))
    assert.equal(built.cached, true)
    assert.equal(built.exe, join(dir, 'Restorm.AppImage'))
    assert.equal(hits.artifact, 0, 'nothing was downloaded')
  })
})

test('a corrupted download is discarded, never executed or cached', async () => {
  const wrong = createHash('sha256').update('something else').digest('hex')
  await withServer({ sha: wrong }, async ({ env, cache }) => {
    await assert.rejects(() => ensureBuild(linux(env)), /checksum mismatch/)
    assert.equal(
      existsSync(join(cache, '9.9.9', 'linux-x64', 'Restorm.AppImage')),
      false,
      'nothing is published under the version directory'
    )
    assert.deepEqual(
      readdirSync(cache).filter((n) => n.startsWith('.staging-')),
      [],
      'the staging directory is cleaned up even on failure'
    )
  })
})

test('a pinned version that the bucket does not carry falls back to the newest', async () => {
  // The server below publishes `latest/` only — the shape of a launcher that
  // reached npm before (or without) its version folder landing in the bucket.
  await withServer({}, async ({ env, hits }) => {
    const built = await ensureBuild({ ...linux(env), ownVersion: '9.9.8' })
    assert.equal(built.version, '9.9.9')
    assert.equal(hits.manifest, 1, 'only the fallback manifest answered')
  })
})

test('an explicitly requested version is never silently substituted', async () => {
  await withServer({}, async ({ env }) => {
    await assert.rejects(
      () => ensureBuild({ ...linux({ ...env, RESTORM_VERSION: '9.9.8' }) }),
      /manifest unavailable: HTTP 404.*v9\.9\.8/s,
      'asking for 9.9.8 and getting 9.9.9 would defeat the point of asking'
    )
  })
})

test('an unpublished platform names itself in the error', async () => {
  await withServer({}, async ({ env }) => {
    await assert.rejects(
      () => ensureBuild({ env, platform: 'linux', arch: 'riscv64', home: '/nonexistent' }),
      /linux-riscv64/
    )
  })
})

test('an unreachable manifest says so, with its URL', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'restorm-cache-'))
  try {
    await assert.rejects(
      () =>
        ensureBuild({
          env: { RESTORM_DL_BASE: 'http://127.0.0.1:1/', RESTORM_CACHE_DIR: cache },
          platform: 'linux',
          arch: 'x64',
          home: '/nonexistent'
        }),
      (e) => /manifest|fetch failed|ECONNREFUSED/i.test(e.message)
    )
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})

test('installing a version prunes all but the previous one', async () => {
  await withServer({}, async ({ env, cache }) => {
    // Distinct mtimes: "the newest previous build" is the whole rule under test,
    // and three directories created in the same millisecond would order at random.
    const olds = ['1.0.0', '1.0.1', '1.0.2']
    olds.forEach((old, i) => {
      mkdirSync(join(cache, old), { recursive: true })
      utimesSync(join(cache, old), 1_000_000 + i * 60, 1_000_000 + i * 60)
    })
    await ensureBuild(linux(env))
    const left = readdirSync(cache)
      .filter((n) => !n.startsWith('.'))
      .sort()
    assert.deepEqual(left, ['1.0.2', '9.9.9'], 'the newest previous build survives, older ones go')
  })
})

test('pruning a cache that does not exist is not an error', () => {
  assert.deepEqual(prune(join(tmpdir(), `restorm-absent-${process.pid}`), '1.0.0'), [])
})
