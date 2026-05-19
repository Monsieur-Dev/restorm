import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MINI_BROWSER_OPEN_CHANNEL,
  MINI_BROWSER_EXECUTE_CHANNEL,
  MINI_BROWSER_EXECUTE_REPLY_CHANNEL
} from '../../types/ipcChannels'

// Controllable electron mock: one fake window whose `webContents.send`
// is a spy, and an `ipcMain` that lets the test capture + fire the
// reply handler the `mini_browser_execute` tool registers.
const mockState = vi.hoisted(() => {
  const sent: { channel: string; payload: unknown }[] = []
  const ipcHandlers = new Map<string, ((e: unknown, payload: unknown) => void)[]>()
  return {
    sent,
    ipcHandlers,
    fakeWindow: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) }
      }
    },
    reset(): void {
      sent.length = 0
      ipcHandlers.clear()
    }
  }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [mockState.fakeWindow],
    getFocusedWindow: () => mockState.fakeWindow
  },
  ipcMain: {
    on: (channel: string, handler: (e: unknown, payload: unknown) => void) => {
      const list = mockState.ipcHandlers.get(channel) ?? []
      list.push(handler)
      mockState.ipcHandlers.set(channel, list)
    },
    off: (channel: string, handler: (e: unknown, payload: unknown) => void) => {
      const list = mockState.ipcHandlers.get(channel) ?? []
      mockState.ipcHandlers.set(channel, list.filter((h) => h !== handler))
    }
  },
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

/** Fire whatever handlers the tool registered on a channel. */
function fireIpc(channel: string, payload: unknown): void {
  for (const handler of mockState.ipcHandlers.get(channel) ?? []) {
    handler({}, payload)
  }
}

function parseText(result: unknown): { text: string; isError: boolean } {
  const r = result as { content: { type: string; text?: string }[]; isError?: boolean }
  const first = r.content[0]
  return { text: first?.text ?? '', isError: r.isError === true }
}

describe('McpService — Mini browser tools', () => {
  beforeEach(() => { mockState.reset() })

  describe('open_mini_browser', () => {
    it('broadcasts the open channel with no payload when no url is given', () => {
      const service = new McpService()
      const result = service.invokeTool('open_mini_browser', {})
      expect(mockState.sent).toEqual([{ channel: MINI_BROWSER_OPEN_CHANNEL, payload: {} }])
      const { text } = parseText(result)
      expect(JSON.parse(text)).toEqual({ opened: true })
    })

    it('broadcasts the open channel with the url when given', () => {
      const service = new McpService()
      const result = service.invokeTool('open_mini_browser', { url: 'example.com' })
      expect(mockState.sent).toEqual([{ channel: MINI_BROWSER_OPEN_CHANNEL, payload: { url: 'example.com' } }])
      const { text } = parseText(result)
      expect(JSON.parse(text)).toEqual({ opened: true, url: 'example.com' })
    })
  })

  describe('mini_browser_execute', () => {
    it('broadcasts the execute channel and resolves with the renderer reply', async () => {
      const service = new McpService()
      const promise = service.invokeTool('mini_browser_execute', { code: '1 + 1' }) as Promise<unknown>

      // The tool broadcast an execute request — grab the requestId it minted.
      const execSend = mockState.sent.find((s) => s.channel === MINI_BROWSER_EXECUTE_CHANNEL)
      if (!execSend) throw new Error('no execute broadcast captured')
      const { requestId, code } = execSend.payload as { requestId: string; code: string }
      expect(code).toBe('1 + 1')

      // Simulate the renderer replying on the reply channel.
      fireIpc(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, { requestId, result: 2 })

      const { text, isError } = parseText(await promise)
      expect(isError).toBe(false)
      expect(JSON.parse(text)).toEqual({ result: 2 })
    })

    it('surfaces a renderer-reported error', async () => {
      const service = new McpService()
      const promise = service.invokeTool('mini_browser_execute', { code: 'boom()' }) as Promise<unknown>
      const execSend = mockState.sent.find((s) => s.channel === MINI_BROWSER_EXECUTE_CHANNEL)
      if (!execSend) throw new Error('no execute broadcast captured')
      const { requestId } = execSend.payload as { requestId: string }

      fireIpc(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, { requestId, error: 'ReferenceError: boom is not defined' })

      const { text, isError } = parseText(await promise)
      expect(isError).toBe(true)
      expect(text).toBe('ReferenceError: boom is not defined')
    })

    it('ignores replies with a mismatched requestId', async () => {
      vi.useFakeTimers()
      const service = new McpService()
      const promise = service.invokeTool('mini_browser_execute', { code: '1', timeoutMs: 500 }) as Promise<unknown>

      // A reply for a different request must not settle this one.
      fireIpc(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, { requestId: 'some-other-id', result: 'wrong' })
      await vi.advanceTimersByTimeAsync(500)

      const { text, isError } = parseText(await promise)
      expect(isError).toBe(true)
      expect(text).toMatch(/no renderer reply within 500ms/)
      vi.useRealTimers()
    })

    it('times out when no reply arrives', async () => {
      vi.useFakeTimers()
      const service = new McpService()
      const promise = service.invokeTool('mini_browser_execute', { code: '1', timeoutMs: 1000 }) as Promise<unknown>
      await vi.advanceTimersByTimeAsync(1000)
      const { text, isError } = parseText(await promise)
      expect(isError).toBe(true)
      expect(text).toMatch(/no renderer reply within 1000ms/)
      vi.useRealTimers()
    })

    it('rejects a missing code argument', async () => {
      const service = new McpService()
      const { text, isError } = parseText(await Promise.resolve(service.invokeTool('mini_browser_execute', {})))
      expect(isError).toBe(true)
      expect(text).toBe('code is required')
    })
  })
})
