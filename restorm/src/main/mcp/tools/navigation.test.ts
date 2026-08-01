import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

// Capture every broadcast for assertions.
const broadcasts: { channel: string; payload: unknown }[] = []

// Configurable fake windows + an `ipcMain` stub so `open_tab`'s ack round-trip
// (broadcast `mcp:open-tab`, await `mcp:open-tab-result`) is drivable from a
// test — mirrors the pattern `git.test.ts` uses for `flushRendererSaveAndAwait`.
// Empty `windowsState` (the default) makes `open_tab` resolve "not opened"
// immediately (no window to ask), so tests that don't care about the ack push
// their own window(s) first.
interface FakeWindow { isDestroyed: () => boolean; webContents: { id: number; send: (channel: string, payload?: unknown) => void } }
const windowsState: FakeWindow[] = []
const ipcMainListeners = new Map<string, Set<(...args: unknown[]) => void>>()
/** Deliver an ack as the given window's `webContents` would — the production
 * listener correlates by `requestId` and tracks which senders have answered,
 * so the event's `sender.id` is load-bearing. */
function emitIpcMain(channel: string, senderId: number, payload: unknown): void {
  for (const listener of [...(ipcMainListeners.get(channel) ?? [])]) listener({ sender: { id: senderId } }, payload)
}

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windowsState },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void): void => {
      const set = ipcMainListeners.get(channel) ?? new Set()
      set.add(listener)
      ipcMainListeners.set(channel, set)
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void): void => {
      ipcMainListeners.get(channel)?.delete(listener)
    }
  }
}))

const mockState = {
  findById: vi.fn<(id: string) => unknown>()
}

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id)
  }
}))

import { registerNavigationTools } from './navigation'
import { SINGLETON_TAB_IDS } from '../../../shared/types/editor'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return await handler(args, {})
  }
}

interface ReplyText { content: { type: 'text'; text: string }[]; isError?: true }
function parseReply(reply: unknown): { isError: boolean; payload: unknown; text: string } {
  const r = reply as ReplyText
  const text = r.content[0]?.text ?? ''
  let payload: unknown = null
  try { payload = JSON.parse(text) } catch { payload = text }
  return { text, isError: r.isError === true, payload }
}

let nextWebContentsId = 1

/** A window that, on `mcp:open-tab`, immediately acks. `opened` may be a
 * predicate so a test can model a renderer whose tree catches up after a
 * few attempts (the projection-lag case the retry exists for). */
function ackingWindow(opened: boolean | (() => boolean)): FakeWindow {
  const id = nextWebContentsId++
  return {
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel: string, payload?: unknown) => {
        broadcasts.push({ channel, payload })
        if (channel === 'mcp:open-tab') {
          const p = payload as { requestId: string }
          emitIpcMain('mcp:open-tab-result', id, { requestId: p.requestId, opened: typeof opened === 'function' ? opened() : opened })
        }
      }
    }
  }
}

/** A window that receives the broadcast but never acks. */
function silentWindow(): FakeWindow {
  const id = nextWebContentsId++
  return {
    isDestroyed: () => false,
    webContents: {
      id,
      send: (channel: string, payload?: unknown) => { broadcasts.push({ channel, payload }) }
    }
  }
}

// NOTE: the `mcp:open-tab-result` listener is installed ONCE (it dispatches
// every in-flight attempt through a requestId map) — so the registry is
// deliberately not cleared between tests, or every test after the first
// would broadcast into the void.
beforeEach(() => {
  broadcasts.length = 0
  windowsState.length = 0
  mockState.findById.mockReset()
})

describe('navigation tools — open_tab', () => {
  it('opens the tab once the renderer acks — resolved kind for a request', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    windowsState.push(ackingWindow(true))
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { payload, isError } = parseReply(await mcp.invoke('open_tab', { itemId: 'r1' }))
    expect(isError).toBe(false)
    expect(payload).toEqual({ itemId: 'r1', kind: 'request', opened: true })
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]?.channel).toBe('mcp:open-tab')
    expect(broadcasts[0]?.payload).toMatchObject({ itemId: 'r1', kind: 'request' })
    expect(typeof (broadcasts[0]?.payload as { requestId?: unknown }).requestId).toBe('string')
  })

  it('detects an env-folder kind correctly', async () => {
    mockState.findById.mockReturnValue({
      id: 'ef', name: 'EF', folderType: 'environment',
      configuration: {}, items: [], environments: []
    })
    windowsState.push(ackingWindow(true))
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('open_tab', { itemId: 'ef' })) as { payload: { kind: string } }
    expect(payload.kind).toBe('env-folder')
  })

  it('detects a plain folder kind correctly', async () => {
    mockState.findById.mockReturnValue({
      id: 'f', name: 'F', configuration: {}, items: []
    })
    windowsState.push(ackingWindow(true))
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('open_tab', { itemId: 'f' })) as { payload: { kind: string } }
    expect(payload.kind).toBe('folder')
  })

  it('returns a clean error for an unknown id (no broadcast)', async () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('open_tab', { itemId: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('No item with id ghost')
    expect(broadcasts).toHaveLength(0)
  })

  it('returns a clean error when itemId is empty', async () => {
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('open_tab', { itemId: '' }))
    expect(isError).toBe(true)
    expect(text).toContain('itemId is required')
    expect(broadcasts).toHaveLength(0)
  })

  it('returns an explicit error — never a silent success — when no window ever acks', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    windowsState.push(silentWindow())
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    vi.useFakeTimers()
    try {
      const invokePromise = mcp.invoke('open_tab', { itemId: 'r1' })
      await vi.advanceTimersByTimeAsync(5000)
      const { isError, text } = parseReply(await invokePromise)
      expect(isError).toBe(true)
      expect(text).toContain('r1')
      expect(text.toLowerCase()).toContain('never confirmed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries while every window reports the item is not in its tree, then errors out', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    windowsState.push(ackingWindow(false))
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    vi.useFakeTimers()
    try {
      const invokePromise = mcp.invoke('open_tab', { itemId: 'r1' })
      await vi.advanceTimersByTimeAsync(5000)
      const { isError } = parseReply(await invokePromise)
      expect(isError).toBe(true)
      // A negative ack ends its attempt at once (no waiting out the whole
      // budget on a window that already answered) and the next attempt goes
      // out after the retry pause — so the budget buys many attempts, not one.
      expect(broadcasts.length).toBeGreaterThan(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('succeeds once the renderer projects the item — the retry absorbs the tree lag', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    let attempts = 0
    // Not in the tree for the first two attempts, then it lands.
    windowsState.push(ackingWindow(() => ++attempts > 2))
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    vi.useFakeTimers()
    try {
      const invokePromise = mcp.invoke('open_tab', { itemId: 'r1' })
      await vi.advanceTimersByTimeAsync(5000)
      const { isError, payload } = parseReply(await invokePromise)
      expect(isError).toBe(false)
      expect(payload).toEqual({ itemId: 'r1', kind: 'request', opened: true })
      expect(attempts).toBe(3)
      expect(broadcasts).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a lone `opened: false` ack never settles the attempt as success — a second window can still open it', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    windowsState.push(ackingWindow(false), ackingWindow(true))
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, payload } = parseReply(await mcp.invoke('open_tab', { itemId: 'r1' }))
    expect(isError).toBe(false)
    expect(payload).toEqual({ itemId: 'r1', kind: 'request', opened: true })
    // One attempt, broadcast to both windows — the refusal didn't trigger a retry.
    expect(broadcasts).toHaveLength(2)
  })

  it('with no open window, resolves not-opened immediately (no hang)', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError } = parseReply(await mcp.invoke('open_tab', { itemId: 'r1' }))
    expect(isError).toBe(true)
    expect(broadcasts).toHaveLength(0)
  })
})

describe('navigation tools — reveal_in_tree', () => {
  it('broadcasts mcp:reveal-in-tree on a known item', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    windowsState.push(silentWindow())
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError } = parseReply(await mcp.invoke('reveal_in_tree', { itemId: 'r1' }))
    expect(isError).toBe(false)
    expect(broadcasts).toEqual([{ channel: 'mcp:reveal-in-tree', payload: { itemId: 'r1', kind: 'request' } }])
  })

  it('returns a clean error for an unknown id (no broadcast)', async () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('reveal_in_tree', { itemId: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('No item with id ghost')
    expect(broadcasts).toHaveLength(0)
  })
})

describe('navigation tools — close_tab', () => {
  it('broadcasts mcp:close-tab on a known item', async () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    windowsState.push(silentWindow())
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError } = parseReply(await mcp.invoke('close_tab', { itemId: 'r1' }))
    expect(isError).toBe(false)
    expect(broadcasts).toEqual([{ channel: 'mcp:close-tab', payload: { itemId: 'r1', kind: 'request' } }])
  })

  it('returns a clean error for an unknown id (no broadcast)', async () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('close_tab', { itemId: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('No item with id ghost')
    expect(broadcasts).toHaveLength(0)
  })

  // The singleton tabs have no project-tree entry, so a tree-only lookup left
  // no MCP route to close them at all.
  it.each(SINGLETON_TAB_IDS)('broadcasts mcp:close-tab for the singleton tab %s', async (tabId) => {
    mockState.findById.mockReturnValue(null)
    windowsState.push(silentWindow())
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError } = parseReply(await mcp.invoke('close_tab', { itemId: tabId }))
    expect(isError).toBe(false)
    expect(broadcasts).toEqual([{ channel: 'mcp:close-tab', payload: { itemId: tabId, kind: 'singleton' } }])
  })
})
