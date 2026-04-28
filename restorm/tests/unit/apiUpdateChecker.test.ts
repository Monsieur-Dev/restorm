import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { runApiUpdateCheck } from '../../src/main/services/apiUpdate/ApiUpdateChecker'
import { apiUpdateStateStore } from '../../src/main/services/apiUpdate/ApiUpdateStateStore'

const minimalSwagger = {
  swagger: '2.0',
  info: { title: 'API', version: '1.0.0' },
  paths: {
    '/pet': {
      get: { operationId: 'listPets', responses: {} }
    }
  }
}

describe('runApiUpdateCheck', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    apiUpdateStateStore.clear()
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.statusText ?? 'OK',
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
    } as Response)
  }

  it('emits idle/firstCheck when no spec was previously imported', async () => {
    mockFetchOnce(minimalSwagger)
    const result = await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: true, interval: 'daily' },
      variables: {},
      manual: false
    })
    expect(result.state.kind).toBe('idle')
    expect(apiUpdateStateStore.get('f1').kind).toBe('idle')
    expect(apiUpdateStateStore.get('f1').lastCheckedAt).toBeTypeOf('number')
  })

  it('emits idle/unchanged when version + hash match the stored markers', async () => {
    mockFetchOnce(minimalSwagger)
    // First check captures the hash & version against an empty store.
    const first = await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: true, interval: 'daily' },
      variables: {},
      manual: false
    })
    if (!first.fetchedSpec) throw new Error('expected fetchedSpec')
    mockFetchOnce(minimalSwagger)
    const second = await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: {
        sourceUrl: 'https://example/spec.json',
        autoCheckEnabled: true,
        interval: 'daily',
        lastImportedSpecVersion: '1.0.0',
        // The store from the first run produced a hash; supply a
        // matching value so the comparator returns 'unchanged'.
        lastImportedSpecHash: (await import('../../src/main/services/apiUpdate/specHash')).computeSpecHash(first.fetchedSpec)
      },
      variables: {},
      manual: false
    })
    expect(second.state.kind).toBe('idle')
  })

  it('emits available when version + hash diverge', async () => {
    mockFetchOnce(minimalSwagger)
    await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: true, interval: 'daily' },
      variables: {},
      manual: false
    })
    mockFetchOnce(minimalSwagger)
    const result = await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: {
        sourceUrl: 'https://example/spec.json',
        autoCheckEnabled: true,
        interval: 'daily',
        lastImportedSpecVersion: '0.9.0',
        lastImportedSpecHash: 'sha256:stale'
      },
      variables: {},
      manual: false
    })
    expect(result.state.kind).toBe('available')
    expect(result.state.availableVersion).toBe('1.0.0')
  })

  it('substitutes ${VAR} into the source URL before fetching', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: () => Promise.resolve(JSON.stringify(minimalSwagger))
    } as Response)
    globalThis.fetch = fetchSpy
    await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: { sourceUrl: 'https://${HOST}/spec.json', autoCheckEnabled: true, interval: 'daily' },
      variables: { HOST: 'example.com' },
      manual: false
    })
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/spec.json', expect.anything())
  })

  it('emits error state on a non-OK fetch', async () => {
    mockFetchOnce({}, { ok: false, status: 503, statusText: 'Service Unavailable' })
    const result = await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: true, interval: 'daily' },
      variables: {},
      manual: true
    })
    expect(result.state.kind).toBe('error')
    expect(result.state.error).toContain('503')
  })

  it('passes ${VAR}-expanded headers to fetch', async () => {
    // Pin the auth flow — the user stores the token in env vars and
    // expects the checker to attach it to the fetch. Without this,
    // protected specs fail with 401 on every auto tick.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: () => Promise.resolve(JSON.stringify(minimalSwagger))
    } as Response)
    globalThis.fetch = fetchSpy
    await runApiUpdateCheck({
      folderId: 'f1',
      importSource: 'swagger',
      config: {
        sourceUrl: 'https://example/spec.json',
        sourceHeaders: { Authorization: 'Bearer ${TOKEN}' },
        autoCheckEnabled: true,
        interval: 'daily'
      },
      variables: { TOKEN: 'abc' },
      manual: false
    })
    expect(fetchSpy).toHaveBeenCalledWith('https://example/spec.json', { headers: { Authorization: 'Bearer abc' } })
  })
})
