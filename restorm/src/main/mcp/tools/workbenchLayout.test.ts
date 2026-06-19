import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

// Local mirror of ECUI's `WorkbenchLayout` shape — importing the type
// from `electron-core-ui/renderer` would drag the real renderer barrel
// (CSS/effects) into the main-process test. The fields exercised here
// match the production type 1:1.
interface LayoutTab { id: string; tabType?: string; title?: string; itemId?: string | null; data?: unknown }
type LayoutNode =
  | { kind: 'tabs'; id: string; activeTabId?: string; tabs: LayoutTab[] }
  | { kind: 'container'; id: string; orientation: 'vertical' | 'horizontal'; sizes?: number[]; groups: LayoutNode[] }
interface WorkbenchLayout {
  orientation: 'vertical' | 'horizontal'
  sizes?: number[]
  focusedGroupId?: string | null
  maximizedTabId?: string | null
  groups: LayoutNode[]
}

// Capture ipcMain handlers + every webContents.send for assertions.
const handlers: Record<string, (event: unknown, payload: unknown) => void> = {}
const broadcasts: { channel: string; payload: unknown }[] = []

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, payload: unknown) => void): void => {
      handlers[channel] = handler
    }
  },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown): void => { broadcasts.push({ channel, payload }) }
      }
    }]
  }
}))

import {
  registerWorkbenchLayoutTools,
  getWorkbenchLayoutSnapshot,
  _resetWorkbenchLayoutForTests,
  WORKBENCH_LAYOUT_CHANGED_CHANNEL,
  SET_WORKBENCH_LAYOUT_CHANNEL
} from './workbenchLayout'

class FakeMcpService {
  private toolHandlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.toolHandlers.set(name, handler)
  }
  invoke(name: string, args: Record<string, unknown> = {}): unknown {
    const handler = this.toolHandlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {})
  }
}

interface ReplyText { content: { type: 'text'; text: string }[]; isError?: true }
function parseReply(reply: unknown): { isError: boolean; payload: unknown } {
  const r = reply as ReplyText
  const text = r.content[0]?.text ?? ''
  let payload: unknown = null
  try { payload = JSON.parse(text) } catch { payload = text }
  return { isError: r.isError === true, payload }
}

const SAMPLE: WorkbenchLayout = {
  orientation: 'vertical',
  sizes: [0.5, 0.5],
  focusedGroupId: 'left',
  maximizedTabId: null,
  groups: [
    { kind: 'tabs', id: 'left', activeTabId: 'r1', tabs: [{ id: 'r1', tabType: 'http-request', title: 'Get', itemId: 'req-1' }] },
    { kind: 'tabs', id: 'right', activeTabId: 'console:singleton', tabs: [{ id: 'console:singleton', tabType: 'console', title: 'Console', itemId: null }] }
  ]
}

let mcp: FakeMcpService

beforeEach(() => {
  _resetWorkbenchLayoutForTests()
  broadcasts.length = 0
  mcp = new FakeMcpService()
  registerWorkbenchLayoutTools(mcp as unknown as McpService)
})

describe('workbench-layout bridge + tools', () => {
  it('reports an empty layout before any push', () => {
    expect(getWorkbenchLayoutSnapshot()).toEqual({ orientation: 'vertical', groups: [] })
  })

  it('caches the pushed layout and get_workbench_layout returns it', () => {
    handlers[WORKBENCH_LAYOUT_CHANGED_CHANNEL]?.(null, SAMPLE)
    expect(getWorkbenchLayoutSnapshot()).toEqual(SAMPLE)
    expect(parseReply(mcp.invoke('get_workbench_layout')).payload).toEqual(SAMPLE)
  })

  it('ignores a malformed push (no groups array)', () => {
    handlers[WORKBENCH_LAYOUT_CHANGED_CHANNEL]?.(null, { orientation: 'vertical' })
    expect(getWorkbenchLayoutSnapshot()).toEqual({ orientation: 'vertical', groups: [] })
  })

  it('set_workbench_layout broadcasts a valid layout to the renderer', () => {
    expect(parseReply(mcp.invoke('set_workbench_layout', { layout: SAMPLE })).payload).toEqual({ applied: true })
    const sent = broadcasts.filter((s) => s.channel === SET_WORKBENCH_LAYOUT_CHANNEL)
    expect(sent).toHaveLength(1)
    const payload = sent[0]?.payload as WorkbenchLayout
    expect(payload.orientation).toBe('vertical')
    expect(Array.isArray(payload.groups)).toBe(true)
  })

  it('set_workbench_layout rejects an invalid spec without broadcasting', () => {
    const reply = parseReply(mcp.invoke('set_workbench_layout', { layout: { orientation: 'sideways', groups: [] } }))
    expect(reply.isError).toBe(true)
    expect(broadcasts.filter((s) => s.channel === SET_WORKBENCH_LAYOUT_CHANNEL)).toHaveLength(0)
  })

  it('set_workbench_layout validates the recursive container shape', () => {
    const nested: WorkbenchLayout = {
      orientation: 'vertical',
      groups: [
        {
          kind: 'container',
          id: 'c',
          orientation: 'horizontal',
          sizes: [0.3, 0.7],
          groups: [
            { kind: 'tabs', id: 'top', activeTabId: 'a', tabs: [{ id: 'a', tabType: 'folder', title: 'f', itemId: 'f1' }] },
            { kind: 'tabs', id: 'bottom', activeTabId: 'b', tabs: [{ id: 'b', tabType: 'mini-browser', title: 'MB', itemId: null }] }
          ]
        }
      ]
    }
    expect(parseReply(mcp.invoke('set_workbench_layout', { layout: nested })).payload).toEqual({ applied: true })
    expect(broadcasts.filter((s) => s.channel === SET_WORKBENCH_LAYOUT_CHANNEL)).toHaveLength(1)
  })
})
