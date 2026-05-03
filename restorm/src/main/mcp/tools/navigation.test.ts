import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

// Capture broadcasts for assertions.
const broadcasts: { channel: string; payload: unknown }[] = []

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown): void => {
          broadcasts.push({ channel, payload })
        }
      }
    }]
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

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  invoke(name: string, args: Record<string, unknown> = {}): unknown {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {})
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

beforeEach(() => {
  broadcasts.length = 0
  mockState.findById.mockReset()
})

describe('navigation tools — open_tab', () => {
  it('broadcasts mcp:open-tab with the resolved kind for a request', () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { payload, isError } = parseReply(mcp.invoke('open_tab', { itemId: 'r1' }))
    expect(isError).toBe(false)
    expect(payload).toEqual({ itemId: 'r1', kind: 'request', queued: true })
    expect(broadcasts).toEqual([{ channel: 'mcp:open-tab', payload: { itemId: 'r1', kind: 'request' } }])
  })

  it('detects an env-folder kind correctly', () => {
    mockState.findById.mockReturnValue({
      id: 'ef', name: 'EF', folderType: 'environment',
      configuration: {}, items: [], environments: []
    })
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('open_tab', { itemId: 'ef' })) as { payload: { kind: string } }
    expect(payload.kind).toBe('env-folder')
  })

  it('detects a plain folder kind correctly', () => {
    mockState.findById.mockReturnValue({
      id: 'f', name: 'F', configuration: {}, items: []
    })
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('open_tab', { itemId: 'f' })) as { payload: { kind: string } }
    expect(payload.kind).toBe('folder')
  })

  it('returns a clean error for an unknown id (no broadcast)', () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('open_tab', { itemId: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('No item with id ghost')
    expect(broadcasts).toHaveLength(0)
  })

  it('returns a clean error when itemId is empty', () => {
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('open_tab', { itemId: '' }))
    expect(isError).toBe(true)
    expect(text).toContain('itemId is required')
    expect(broadcasts).toHaveLength(0)
  })
})

describe('navigation tools — reveal_in_tree', () => {
  it('broadcasts mcp:reveal-in-tree on a known item', () => {
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r1', type: 'http' })
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError } = parseReply(mcp.invoke('reveal_in_tree', { itemId: 'r1' }))
    expect(isError).toBe(false)
    expect(broadcasts).toEqual([{ channel: 'mcp:reveal-in-tree', payload: { itemId: 'r1', kind: 'request' } }])
  })

  it('returns a clean error for an unknown id (no broadcast)', () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerNavigationTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('reveal_in_tree', { itemId: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('No item with id ghost')
    expect(broadcasts).toHaveLength(0)
  })
})
