import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

vi.mock('electron-core-ui', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { ApiUpdateScheduler, type ApiUpdateSchedulerFolder } from '../../src/main/services/apiUpdate/ApiUpdateScheduler'
import { apiUpdateStateStore } from '../../src/main/services/apiUpdate/ApiUpdateStateStore'

const minimalSwagger = {
  swagger: '2.0',
  info: { title: 'API', version: '1.0.0' },
  paths: { '/a': { get: { operationId: 'a', responses: {} } } }
}

function mockFetch(): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify(minimalSwagger))
  } as Response)
}

function makeFolder(overrides: Partial<ApiUpdateSchedulerFolder> = {}): ApiUpdateSchedulerFolder {
  return {
    folderId: 'f1',
    importSource: 'swagger',
    config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: true, interval: 'daily' },
    variables: {},
    onCheckCompleted: vi.fn(),
    ...overrides
  }
}

describe('ApiUpdateScheduler', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    apiUpdateStateStore.clear()
    originalFetch = globalThis.fetch
    mockFetch()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('does not fire a check when no folder is due', async () => {
    const scheduler = new ApiUpdateScheduler()
    const folder = makeFolder({
      // lastCheckedAt is "now", so the daily interval keeps it not-due.
      config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: true, interval: 'daily', lastCheckedAt: Date.now() }
    })
    scheduler.setFolders([folder])
    await scheduler.tick()
    expect(folder.onCheckCompleted).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('fires a check on a never-checked folder', async () => {
    const scheduler = new ApiUpdateScheduler()
    const folder = makeFolder()
    scheduler.setFolders([folder])
    await scheduler.tick()
    expect(folder.onCheckCompleted).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('skips folders with autoCheckEnabled = false', async () => {
    const scheduler = new ApiUpdateScheduler()
    const disabled = makeFolder({
      folderId: 'disabled',
      config: { sourceUrl: 'https://example/spec.json', autoCheckEnabled: false, interval: 'hourly' }
    })
    const enabled = makeFolder({ folderId: 'enabled' })
    scheduler.setFolders([disabled, enabled])
    await scheduler.tick()
    expect(disabled.onCheckCompleted).not.toHaveBeenCalled()
    expect(enabled.onCheckCompleted).toHaveBeenCalled()
  })

  it('checkNow runs even if the folder is not due', async () => {
    // Pin the manual override — the user clicked "Check now" and the
    // schedule must not gate that. A regression here would silently
    // make manual triggers no-op when the daily window hasn't elapsed.
    const scheduler = new ApiUpdateScheduler()
    const folder = makeFolder({
      config: {
        sourceUrl: 'https://example/spec.json',
        autoCheckEnabled: true,
        interval: 'daily',
        lastCheckedAt: Date.now()
      }
    })
    scheduler.setFolders([folder])
    await scheduler.checkNow('f1')
    expect(folder.onCheckCompleted).toHaveBeenCalled()
  })

  it('checkNow on an unknown folder is a no-op', async () => {
    const scheduler = new ApiUpdateScheduler()
    await scheduler.checkNow('does-not-exist')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
