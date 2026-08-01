import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runInNewContext } from 'node:vm'

/**
 * `wait-for` returning a bare `ok: true` is ambiguous in two ways that have
 * already shipped a wrong result: a satisfied `absent` looks exactly like a
 * satisfied `present`, and with more than one window open the polled window
 * need not be the one the caller goes on to screenshot. The reply therefore
 * carries what the renderer actually saw — how many elements matched, and
 * which window was polled.
 */

const windows = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => windows.list,
    getFocusedWindow: () => windows.list[0] ?? null
  },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { McpService } from './McpService'

interface ToolResult {
  isError?: boolean
  content: { type: string; text?: string }[]
}

/** Runs the injected poll loop for real, against a stub `document`. */
function installWindow(id: number, querySelectorAll: (sel: string) => unknown[]): void {
  windows.list = [{
    isDestroyed: () => false,
    isVisible: () => true,
    webContents: {
      id,
      // Runs the real injected source in a sandbox, so the assertions cover
      // the poll loop itself rather than a hand-written imitation of it.
      executeJavaScript: (code: string): Promise<unknown> =>
        runInNewContext(code, {
          document: { querySelectorAll: (sel: string) => querySelectorAll(sel) },
          setTimeout,
          Promise,
          Date
        }) as Promise<unknown>
    }
  }]
}

function textOf(result: unknown): string {
  return (result as ToolResult).content[0]?.text ?? ''
}

beforeEach(() => { windows.list = [] })

describe('wait-for reply diagnostics', () => {
  it('reports how many elements matched and which window was polled', async () => {
    installWindow(7, () => [{ textContent: 'hi', getAttribute: () => null }])
    const service = new McpService()

    const result = await Promise.resolve(
      service.invokeTool('wait-for', { selector: '.thing', condition: 'present' })
    )

    const payload = JSON.parse(textOf(result)) as { matchCount: number; windowId: number; ok: boolean }
    expect(payload.ok).toBe(true)
    expect(payload.matchCount).toBe(1)
    expect(payload.windowId).toBe(7)
  })

  it('distinguishes a satisfied `absent` by reporting zero matches', async () => {
    installWindow(7, () => [])
    const service = new McpService()

    const result = await Promise.resolve(
      service.invokeTool('wait-for', { selector: '.ghost', condition: 'absent' })
    )

    const payload = JSON.parse(textOf(result)) as { matchCount: number; condition: string }
    expect(payload.matchCount).toBe(0)
    expect(payload.condition).toBe('absent')
  })

  it('fails a `present` on a selector that matches nothing', async () => {
    installWindow(7, () => [])
    const service = new McpService()

    const result = await Promise.resolve(
      service.invokeTool('wait-for', { selector: '.ghost', condition: 'present', timeoutMs: 50 })
    ) as ToolResult

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('0 element(s) matched')
    expect(textOf(result)).toContain('windowId 7')
  })

  it('hard-errors on an invalid CSS selector instead of polling it to a timeout', async () => {
    installWindow(7, () => { throw new Error("'((' is not a valid selector") })
    const service = new McpService()

    const result = await Promise.resolve(
      service.invokeTool('wait-for', { selector: '((', condition: 'present', timeoutMs: 50 })
    ) as ToolResult

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('is not a valid CSS selector')
  })
})
