import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SET_TAB_MAXIMIZED_CHANNEL } from '../../types/ipcChannels'

// One fake window whose `webContents.send` is a spy, so the test can
// assert the tool broadcasts on the right channel with the right payload.
const mockState = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  return {
    sent,
    fakeWindow: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) }
      }
    },
    reset(): void { sent.length = 0 }
  }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [mockState.fakeWindow],
    getFocusedWindow: () => mockState.fakeWindow
  },
  ipcMain: { on: vi.fn(), off: vi.fn() },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { McpService } from './McpService'

function parseText(result: unknown): unknown {
  const r = result as { content: { type: string; text?: string }[]; isError?: boolean }
  return JSON.parse(r.content[0]?.text ?? '{}')
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true
}

describe('McpService — set_tab_maximized tool', () => {
  beforeEach(() => { mockState.reset() })

  it('maximizes a tab: broadcasts the channel with the tab id', () => {
    const service = new McpService()
    const result = service.invokeTool('set_tab_maximized', { tabId: 'request-id:abc', maximized: true })
    expect(mockState.sent).toEqual([
      { channel: SET_TAB_MAXIMIZED_CHANNEL, payload: { tabId: 'request-id:abc', maximized: true } }
    ])
    expect(parseText(result)).toEqual({ tabId: 'request-id:abc', maximized: true })
  })

  it('restores: broadcasts maximized:false with a null tabId, ignoring any tabId passed', () => {
    const service = new McpService()
    const result = service.invokeTool('set_tab_maximized', { tabId: 'request-id:abc', maximized: false })
    expect(mockState.sent).toEqual([
      { channel: SET_TAB_MAXIMIZED_CHANNEL, payload: { tabId: null, maximized: false } }
    ])
    expect(parseText(result)).toEqual({ tabId: null, maximized: false })
  })

  it('coerces the string "true" (the wire form when called via batch / invokeTool)', () => {
    const service = new McpService()
    service.invokeTool('set_tab_maximized', { tabId: 'console:singleton', maximized: 'true' })
    expect(mockState.sent).toEqual([
      { channel: SET_TAB_MAXIMIZED_CHANNEL, payload: { tabId: 'console:singleton', maximized: true } }
    ])
  })

  it('rejects maximize without a tabId and broadcasts nothing', () => {
    const service = new McpService()
    const result = service.invokeTool('set_tab_maximized', { maximized: true })
    expect(isError(result)).toBe(true)
    expect(mockState.sent).toEqual([])
  })
})
