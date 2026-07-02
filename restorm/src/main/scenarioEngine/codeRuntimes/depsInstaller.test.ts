import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: (): string => tmpdir() } }))

import { ensurePackagesCached, httpGetBytes, httpGetText, type ArtifactFetcher } from './depsInstaller'
import { cachedArtifacts } from './depsCache'
import type { PackageSpec } from './types'

const wheelName = (s: PackageSpec): string => `${s.name}-${s.version}-py3-none-any.whl`

describe('ensurePackagesCached', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'deps-installer-')) })
  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
    delete process.env['RESTORM_CODE_DEPS_OFFLINE_DIR']
  })

  it('downloads a missing package once and caches the artifact', async () => {
    const spec = { name: 'left-pad', version: '1.3.0' }
    const fetcher = vi.fn<ArtifactFetcher>((s) => Promise.resolve([{ filename: wheelName(s), data: new Uint8Array([9]) }]))
    await ensurePackagesCached('python', cacheDir, [spec], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cachedArtifacts(cacheDir, spec)).toHaveLength(1)
  })

  it('is idempotent — a second call for an already-cached package skips the fetch', async () => {
    const spec = { name: 'idem', version: '2.0.0' }
    const fetcher = vi.fn<ArtifactFetcher>((s) => Promise.resolve([{ filename: wheelName(s), data: new Uint8Array([1]) }]))
    await ensurePackagesCached('python', cacheDir, [spec], fetcher)
    await ensurePackagesCached('python', cacheDir, [spec], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent requests for the same artifact onto a single download (lock)', async () => {
    const spec = { name: 'racey', version: '0.1.0' }
    let resolveFetch: (() => void) | undefined
    const gate = new Promise<void>((r) => { resolveFetch = r })
    const fetcher = vi.fn<ArtifactFetcher>(async (s) => { await gate; return [{ filename: wheelName(s), data: new Uint8Array([7]) }] })
    const a = ensurePackagesCached('python', cacheDir, [spec], fetcher)
    const b = ensurePackagesCached('python', cacheDir, [spec], fetcher)
    resolveFetch?.()
    await Promise.all([a, b])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('copies from the offline mirror with zero network when RESTORM_CODE_DEPS_OFFLINE_DIR is set', async () => {
    const spec = { name: 'offline', version: '3.3.3' }
    const mirror = mkdtempSync(join(tmpdir(), 'deps-mirror-'))
    const mirrorPkgDir = join(mirror, 'python', `${spec.name}@${spec.version}`)
    mkdirSync(mirrorPkgDir, { recursive: true })
    writeFileSync(join(mirrorPkgDir, wheelName(spec)), Buffer.from([5]))
    process.env['RESTORM_CODE_DEPS_OFFLINE_DIR'] = mirror
    const fetcher = vi.fn<ArtifactFetcher>(() => Promise.reject(new Error('network must not be used')))
    try {
      await ensurePackagesCached('python', cacheDir, [spec], fetcher)
      expect(fetcher).not.toHaveBeenCalled()
      expect(cachedArtifacts(cacheDir, spec)).toHaveLength(1)
    } finally {
      rmSync(mirror, { recursive: true, force: true })
    }
  })

  it('propagates the fetcher error (routed to the node error port upstream)', async () => {
    const spec = { name: 'broken', version: '0.0.1' }
    const fetcher = vi.fn<ArtifactFetcher>(() => Promise.reject(new Error('no pure-Python wheel')))
    await expect(ensurePackagesCached('python', cacheDir, [spec], fetcher)).rejects.toThrow(/no pure-Python wheel/)
  })

  it('rejects when the fetcher yields no artifact', async () => {
    const spec = { name: 'empty', version: '0.0.0' }
    const fetcher = vi.fn<ArtifactFetcher>(() => Promise.resolve([]))
    await expect(ensurePackagesCached('python', cacheDir, [spec], fetcher)).rejects.toThrow(/no artifact produced/)
  })

  it('passes the cacheDir through to the fetcher (a runtime writing a side artifact of its own)', async () => {
    const spec = { name: 'side-artifact', version: '1.0.0' }
    const fetcher = vi.fn<ArtifactFetcher>((s) => Promise.resolve([{ filename: wheelName(s), data: new Uint8Array([1]) }]))
    await ensurePackagesCached('python', cacheDir, [spec], fetcher)
    expect(fetcher).toHaveBeenCalledWith(spec, cacheDir)
  })

  it('fires onDownloadStart only for packages that actually fetch (not offline/cache hits)', async () => {
    const spec = { name: 'hooked', version: '1.0.0' }
    const fetcher = vi.fn<ArtifactFetcher>((s) => Promise.resolve([{ filename: wheelName(s), data: new Uint8Array([1]) }]))
    const onStart = vi.fn()
    await ensurePackagesCached('python', cacheDir, [spec], fetcher, onStart)
    expect(onStart).toHaveBeenCalledTimes(1)
    await ensurePackagesCached('python', cacheDir, [spec], fetcher, onStart)
    expect(onStart).toHaveBeenCalledTimes(1) // cached second time → no start hook
  })
})

// The registry/artifact GET helpers run firewall-BYPASSED, so they carry their
// own SSRF guard. A blocked host is rejected BEFORE any network call, so these
// need no fetch mock — the guard throws synchronously inside the helper.
describe('httpGet* SSRF guard', () => {
  it('rejects a cloud-metadata target (link-local, always blocked)', async () => {
    await expect(httpGetText('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/link-local|metadata/)
    await expect(httpGetBytes('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/link-local|metadata/)
  })

  it('rejects a loopback target', async () => {
    await expect(httpGetText('http://localhost:9000/pypi/json')).rejects.toThrow(/loopback/)
    await expect(httpGetText('http://127.0.0.1/pypi/json')).rejects.toThrow(/private|loopback/)
  })

  it('rejects an RFC1918 private target (a registry response can never point here)', async () => {
    await expect(httpGetBytes('http://10.0.0.5/wheel.whl')).rejects.toThrow(/private|loopback/)
    await expect(httpGetBytes('http://192.168.1.10/wheel.whl')).rejects.toThrow(/private|loopback/)
  })

  it('rejects a non-http(s) scheme', async () => {
    await expect(httpGetText('file:///etc/passwd')).rejects.toThrow(/scheme/)
  })
})
