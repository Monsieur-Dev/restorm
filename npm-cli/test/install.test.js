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
  utimesSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { ensureBuild, prune } = require('../lib/install')

const PAYLOAD = '#!/bin/sh\necho restorm-stub\n'
const SHA = createHash('sha256').update(PAYLOAD).digest('hex')

function startServer({ sha = SHA, version = '9.9.9' } = {}) {
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
              size: PAYLOAD.length,
              exec: 'Restorm.AppImage'
            }
          }
        })
      )
      return
    }
    if (req.url.endsWith('.AppImage')) {
      hits.artifact += 1
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': PAYLOAD.length })
      res.end(PAYLOAD)
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
    assert.equal(first.exe, join(cache, '9.9.9', 'linux-x64', 'Restorm.AppImage'))
    assert.equal(readFileSync(first.exe, 'utf8'), PAYLOAD)
    assert.ok(statSync(first.exe).mode & 0o111, 'the AppImage is made executable')
    assert.equal(hits.artifact, 1)

    const second = await ensureBuild(linux(env))
    assert.equal(second.cached, true)
    assert.equal(second.exe, first.exe)
    assert.equal(hits.artifact, 1, 'the cached build is reused instead of re-downloaded')
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
