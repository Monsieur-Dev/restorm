import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The `batch` tool waits one painted frame between steps. Chromium produces
 * NO frames for a window that is unfocused, minimised or occluded, so that
 * wait must be bounded — unbounded, a batch of even a single trivial step
 * never returns, and the caller reads the silence as "the app is wedged"
 * when the renderer is in fact answering normally.
 */

interface FakeWindow {
  isDestroyed: () => boolean
  isVisible: () => boolean
  webContents: { id: number; executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown> }
}

const windows = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => windows.list,
    getFocusedWindow: () => windows.list[0] ?? null
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

interface BatchEnvelope {
  ranCount: number
  aborted: boolean
  results: { index: number; name: string; ok: boolean; settle?: string }[]
  settleNote?: string
}

function parseEnvelope(result: unknown): BatchEnvelope {
  const r = result as { content: { type: string; text?: string }[] }
  const last = r.content[r.content.length - 1]
  if (last?.type !== 'text' || typeof last.text !== 'string') throw new Error('no envelope')
  return JSON.parse(last.text) as BatchEnvelope
}

function installWindow(executeJavaScript: FakeWindow['webContents']['executeJavaScript']): void {
  windows.list = [
    {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: { id: 1, executeJavaScript }
    } satisfies FakeWindow
  ]
}

function serviceWithTrivialStep(): McpService {
  const service = new McpService()
  service.registerTool('noop', { titleKey: 'mcpToolTitles.test', title: 'noop' }, () => ({
    content: [{ type: 'text', text: 'ok' }]
  }))
  return service
}

beforeEach(() => {
  windows.list = []
})

describe('McpService — batch implicit settle', () => {
  it('completes and flags the settle when the window never paints a frame', async () => {
    // A renderer that never answers stands in for the unfocused-window case:
    // the settle promise the batch awaits simply never resolves.
    installWindow(() => new Promise<unknown>(() => { /* never resolves */ }))
    const service = serviceWithTrivialStep()

    const out = await Promise.resolve(service.invokeTool('batch', { steps: [{ name: 'noop' }] }))

    const env = parseEnvelope(out)
    expect(env.aborted).toBe(false)
    expect(env.ranCount).toBe(1)
    expect(env.results[0]?.settle).toBe('timed-out')
    expect(env.settleNote).toContain('unfocused')
  }, 10_000)

  it('does not flag a settle when the frame arrives', async () => {
    installWindow(() => Promise.resolve('settled'))
    const service = serviceWithTrivialStep()

    const out = await Promise.resolve(service.invokeTool('batch', { steps: [{ name: 'noop' }] }))

    const env = parseEnvelope(out)
    expect(env.results[0]?.settle).toBeUndefined()
    expect(env.settleNote).toBeUndefined()
  })

  it('races the frame against a renderer-side timer', async () => {
    // The primary guard lives IN the renderer: main only caps the call in
    // case the renderer itself is unresponsive. Assert the injected code
    // arms its own timeout rather than awaiting the frame unconditionally.
    let injected = ''
    installWindow((code) => {
      injected = code
      return Promise.resolve('settled')
    })
    const service = serviceWithTrivialStep()

    await Promise.resolve(service.invokeTool('batch', { steps: [{ name: 'noop' }] }))

    expect(injected).toContain('requestAnimationFrame')
    expect(injected).toContain('setTimeout')
    expect(injected).toContain('timed-out')
  })
})
