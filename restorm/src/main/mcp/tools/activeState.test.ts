import { describe, it, expect, beforeEach, vi } from 'vitest'

// Capture handlers ipcMain.on registers so the test can trigger them
// without spinning up a real Electron context. The mock factory matches
// the real `ipcMain` shape just enough for `registerActiveStateBridge`.
const handlers: Record<string, (event: unknown, payload: unknown) => void> = {}

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, payload: unknown) => void): void => {
      handlers[channel] = handler
    }
  }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { registerActiveStateBridge, getCurrentTabSnapshot, pickSelectedEnvId, _resetActiveStateForTests } from './activeState'

beforeEach(() => {
  _resetActiveStateForTests()
})

describe('activeState bridge', () => {
  it('captures the active-tab snapshot from an IPC push', () => {
    registerActiveStateBridge()
    handlers['mcp:active-tab-changed']?.(null, { tabId: 't1', itemId: 'i1', kind: 'request' })
    expect(getCurrentTabSnapshot()).toEqual({ tabId: 't1', itemId: 'i1', kind: 'request' })
  })

  it('captures a scenario tab snapshot', () => {
    registerActiveStateBridge()
    handlers['mcp:active-tab-changed']?.(null, { tabId: 't2', itemId: 'scn-1', kind: 'scenario' })
    expect(getCurrentTabSnapshot()).toEqual({ tabId: 't2', itemId: 'scn-1', kind: 'scenario' })
  })

  it('rejects unknown kind values, defaulting kind to null', () => {
    registerActiveStateBridge()
    handlers['mcp:active-tab-changed']?.(null, { tabId: 't1', itemId: 'i1', kind: 'wat' })
    expect(getCurrentTabSnapshot().kind).toBe(null)
  })

  it('caches per-folder env selection and respects liveEnvIds when reading back', () => {
    registerActiveStateBridge()
    handlers['mcp:active-env-changed']?.(null, { envFolderId: 'ef-1', envId: 'env-A' })
    expect(pickSelectedEnvId('ef-1', ['env-A', 'env-B'])).toBe('env-A')
    expect(pickSelectedEnvId('ef-1', ['env-B'])).toBe(null) // env-A no longer live
    expect(pickSelectedEnvId('ef-2', ['env-X'])).toBe(null) // never set
  })

  it('treats null env push as "no selection"', () => {
    registerActiveStateBridge()
    handlers['mcp:active-env-changed']?.(null, { envFolderId: 'ef-1', envId: null })
    expect(pickSelectedEnvId('ef-1', ['env-A'])).toBe(null)
  })

  it('bootstrap push replaces both tab + env-by-folder caches atomically', () => {
    registerActiveStateBridge()
    handlers['mcp:active-env-changed']?.(null, { envFolderId: 'ef-old', envId: 'env-old' })
    handlers['mcp:active-state-bootstrap']?.(null, {
      tab: { tabId: 'boot-tab', itemId: 'boot-item', kind: 'env-folder' },
      envByFolder: { 'ef-new': 'env-new' }
    })
    expect(getCurrentTabSnapshot()).toEqual({ tabId: 'boot-tab', itemId: 'boot-item', kind: 'env-folder' })
    expect(pickSelectedEnvId('ef-new', ['env-new'])).toBe('env-new')
    expect(pickSelectedEnvId('ef-old', ['env-old'])).toBe(null) // cleared by bootstrap
  })
})
