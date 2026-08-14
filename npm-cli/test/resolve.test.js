'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const resolve = require('../lib/resolve')

test('the cache lives where each OS puts regenerable data', () => {
  assert.equal(
    resolve.cacheRoot({}, 'linux', '/home/u'),
    '/home/u/.cache/restorm',
    'Linux falls back to ~/.cache when XDG_CACHE_HOME is unset'
  )
  assert.equal(resolve.cacheRoot({ XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/u'), '/xdg/restorm')
  assert.equal(resolve.cacheRoot({}, 'darwin', '/Users/u'), '/Users/u/Library/Caches/restorm')
  assert.match(resolve.cacheRoot({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\U'), /^C:\\L[\\/]restorm/)
})

test('RESTORM_CACHE_DIR wins over every platform default', () => {
  const env = { RESTORM_CACHE_DIR: '/tmp/pinned', XDG_CACHE_HOME: '/xdg' }
  for (const platform of ['linux', 'darwin', 'win32']) {
    assert.equal(resolve.cacheRoot(env, platform, '/home/u'), '/tmp/pinned')
  }
})

test('the manifest is fetched per platform, from an overridable base', () => {
  assert.equal(
    resolve.manifestUrl({}, 'darwin'),
    'https://dl.restorm.app/latest/manifest-darwin.json'
  )
  assert.equal(
    resolve.manifestUrl({ RESTORM_DL_BASE: 'http://127.0.0.1:8080/' }, 'win32'),
    'http://127.0.0.1:8080/latest/manifest-win32.json'
  )
})

test('a pinned launcher asks for its own version, not the newest release', () => {
  assert.equal(
    resolve.manifestUrl({}, 'linux', '1.0.2'),
    'https://dl.restorm.app/v1.0.2/manifest-linux.json',
    'restorm-cli@1.0.2 must still run Restorm 1.0.2 next year'
  )
  assert.equal(
    resolve.manifestUrl({ RESTORM_VERSION: '1.0.1' }, 'linux', '1.0.2'),
    'https://dl.restorm.app/v1.0.1/manifest-linux.json',
    'an explicit version wins over the package version'
  )
  assert.equal(
    resolve.manifestUrl({ RESTORM_VERSION: 'latest' }, 'linux', '1.0.2'),
    'https://dl.restorm.app/latest/manifest-linux.json',
    'and "latest" opts back into following releases'
  )
  assert.equal(
    resolve.manifestUrl({}, 'linux', '0.0.0-dev'),
    'https://dl.restorm.app/latest/manifest-linux.json',
    'an unpublished working copy has no version folder to ask for'
  )
})

test('an artifact is selected by platform AND architecture', () => {
  const manifest = {
    version: '1.2.3',
    artifacts: {
      'darwin-x64': { kind: 'zip', url: 'https://x/Restorm-mac.zip', sha256: 'AABB', size: 10 },
      'darwin-arm64': { kind: 'zip', url: 'https://x/Restorm-arm64-mac.zip', sha256: 'ccdd' }
    }
  }
  const intel = resolve.pickArtifact(manifest, 'darwin', 'x64')
  assert.equal(intel.url, 'https://x/Restorm-mac.zip')
  assert.equal(intel.sha256, 'aabb', 'checksums are compared lower-case')
  assert.equal(intel.file, 'Restorm-mac.zip', 'the file name falls back to the URL tail')
  assert.equal(intel.exec, 'Restorm.app/Contents/MacOS/Restorm')

  assert.equal(resolve.pickArtifact(manifest, 'darwin', 'arm64').url, 'https://x/Restorm-arm64-mac.zip')
  assert.equal(resolve.pickArtifact(manifest, 'linux', 'x64'), null, 'an absent platform is not a crash')
})

test('an entry without a checksum is refused, not silently trusted', () => {
  const manifest = { version: '1', artifacts: { 'linux-x64': { url: 'https://x/a.AppImage' } } }
  assert.throws(() => resolve.pickArtifact(manifest, 'linux', 'x64'), /sha256/)
})

test('unpacking uses a tool the OS already ships, with a fallback', () => {
  const mac = resolve.extractCommands('darwin', '/a.zip', '/d')
  assert.deepEqual(mac[0], { cmd: 'ditto', args: ['-x', '-k', '/a.zip', '/d'] })
  assert.equal(mac[1].cmd, 'unzip')

  const win = resolve.extractCommands('win32', 'C:\\a.zip', 'C:\\d')
  assert.deepEqual(win[0], { cmd: 'tar', args: ['-xf', 'C:\\a.zip', '-C', 'C:\\d'] })
  assert.equal(win[1].cmd, 'powershell')
  assert.match(win[1].args.at(-1), /Expand-Archive/)

  assert.deepEqual(resolve.extractCommands('linux', '/a.AppImage', '/d'), [], 'an AppImage is not an archive')
})

test('pruning keeps the version in use and one more', () => {
  const versions = [
    { name: '1.0.0', mtimeMs: 100 },
    { name: '1.0.1', mtimeMs: 200 },
    { name: '1.0.2', mtimeMs: 300 },
    { name: '1.0.3', mtimeMs: 400 }
  ]
  assert.deepEqual(resolve.pruneVictims(versions, '1.0.3'), ['1.0.1', '1.0.0'])
  assert.deepEqual(
    resolve.pruneVictims(versions, '1.0.0'),
    ['1.0.2', '1.0.1'],
    'the version in use is kept however old it is'
  )
  assert.deepEqual(resolve.pruneVictims([{ name: '2.0.0', mtimeMs: 1 }], '2.0.0'), [])
})
