import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CONSOLE_OPEN_CHANNEL, CONSOLE_CLEAR_CHANNEL } from '../../types/ipcChannels'

// One fake window whose `webContents.send` is a spy, so the test can
// assert the console tools broadcast on the right channels.
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
  const r = result as { content: { type: string; text?: string }[] }
  return JSON.parse(r.content[0]?.text ?? '{}')
}

describe('McpService — Console tools', () => {
  beforeEach(() => { mockState.reset() })

  it('open_console broadcasts the open channel', () => {
    const service = new McpService()
    const result = service.invokeTool('open_console', {})
    expect(mockState.sent).toEqual([{ channel: CONSOLE_OPEN_CHANNEL, payload: {} }])
    expect(parseText(result)).toEqual({ opened: true })
  })

  it('console_clear broadcasts the clear channel', () => {
    const service = new McpService()
    const result = service.invokeTool('console_clear', {})
    expect(mockState.sent).toEqual([{ channel: CONSOLE_CLEAR_CHANNEL, payload: {} }])
    expect(parseText(result)).toEqual({ cleared: true })
  })
})
