import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'
import type { RecordedCallDetail, RecordedCallSummary, RecordingFilterConfig, RecordingRun, RecordingStatus } from '../../../shared/types/recordingCapture'

// ── fakes ───────────────────────────────────────────────────────────────────

interface FakeWindow { isDestroyed: () => boolean; webContents: { id: number; send: (channel: string, payload?: unknown) => void } }
const windowsState: FakeWindow[] = []
const broadcasts: { channel: string; payload: unknown }[] = []
const ipcMainListeners = new Map<string, Set<(...args: unknown[]) => void>>()
function emitIpcMain(channel: string, senderId: number, payload: unknown): void {
  for (const listener of [...(ipcMainListeners.get(channel) ?? [])]) listener({ sender: { id: senderId } }, payload)
}
function addWindow(id: number): void {
  windowsState.push({ isDestroyed: () => false, webContents: { id, send: (channel, payload) => { broadcasts.push({ channel, payload }) } } })
}

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windowsState },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void): void => {
      const set = ipcMainListeners.get(channel) ?? new Set()
      set.add(listener)
      ipcMainListeners.set(channel, set)
    }
  }
}))

// A tiny in-memory tree standing in for the CollectionStore.
interface StoredSession {
  type: 'recording'; id: string; name: string; url: string; notes?: string
  protocols: string[]; whitelist: string[]; blacklist: string[]; items?: unknown[]
}
const tree: { items: unknown[]; sessions: Map<string, StoredSession>; parents: Map<string, string | null>; versionBumps: number } = {
  items: [], sessions: new Map(), parents: new Map(), versionBumps: 0
}
const folder = { id: 'env-1', name: 'Petstore', folderType: 'environment', items: [] as unknown[], environments: [], documentation: '', tags: [], configuration: {} }
let nextId = 1

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    getCollections: () => [folder, ...tree.items],
    findById: (id: string) => {
      if (id === folder.id) return folder
      return tree.sessions.get(id) ?? null
    },
    findParentFolder: (id: string) => (tree.parents.get(id) === folder.id ? folder : null),
    createRecording: (parentId: string | null, data: Partial<StoredSession> & { name: string }) => {
      const session: StoredSession = {
        type: 'recording', id: `s-${String(nextId++)}`, name: data.name, url: data.url ?? '',
        protocols: data.protocols ?? ['http', 'websocket', 'graphql', 'grpc-web'],
        whitelist: data.whitelist ?? [], blacklist: data.blacklist ?? [],
        ...(data.notes !== undefined ? { notes: data.notes } : {})
      }
      tree.sessions.set(session.id, session)
      tree.parents.set(session.id, parentId)
      if (parentId === folder.id) folder.items.push(session); else tree.items.push(session)
      return session
    },
    updateRecording: (id: string, patch: Partial<StoredSession>) => {
      const session = tree.sessions.get(id)
      if (!session) return null
      Object.assign(session, patch)
      return session
    },
    notifyRecordingUpdated: vi.fn(),
    bumpModelVersion: () => { tree.versionBumps += 1; return tree.versionBumps }
  }
}))

const captureState: {
  status: Map<string, RecordingStatus>
  runs: RecordingRun[]
  captures: RecordedCallSummary[]
  details: Map<string, RecordedCallDetail>
  filters: Map<string, RecordingFilterConfig>
  applied: string[]
} = { status: new Map(), runs: [], captures: [], details: new Map(), filters: new Map(), applied: [] }

function statusOf(sessionId: string): RecordingStatus {
  return captureState.status.get(sessionId) ?? { sessionId, state: 'idle', runId: null, tabId: null, captureCount: captureState.captures.length }
}

vi.mock('../../services/recording/RecordingCaptureStore', () => ({
  recordingCaptureStore: {
    status: (sessionId: string) => statusOf(sessionId),
    runs: () => captureState.runs,
    list: () => captureState.captures,
    get: (_sessionId: string, id: string) => captureState.details.get(id) ?? null,
    setFilters: (sessionId: string, config: RecordingFilterConfig) => { captureState.filters.set(sessionId, config) },
    applyFiltersToExisting: () => captureState.applied
  }
}))

const engineStop = vi.fn<(sessionId: string) => RecordingStatus>((sessionId) => {
  captureState.status.delete(sessionId)
  return statusOf(sessionId)
})
vi.mock('../../services/recording/RecordingCaptureEngine', () => ({
  recordingCaptureEngine: { stop: (sessionId: string) => engineStop(sessionId) }
}))

const historyStored = vi.fn<(sessionId: string, plan: unknown[]) => Promise<number>>(() => Promise.resolve(3))
vi.mock('../../services/recording/recordingIpc', () => ({
  materializeRecordingHistory: (sessionId: string, plan: unknown[]) => historyStored(sessionId, plan)
}))

const treeReplaceSpy = vi.fn()
vi.mock('./import', () => ({ broadcastTreeReplace: () => { treeReplaceSpy() } }))

import { registerRecordingTools } from './recording'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  readonly names: string[] = []
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
    this.names.push(name)
  }
  async invoke(name: string, args: Record<string, unknown> = {}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return await handler(args, {}) as { content: { type: 'text'; text: string }[]; isError?: true }
  }
}

/** Parse a JSON tool reply; `T` names the shape the caller asserts on (the
 * phantom `shape` member only carries it — replies never have one). */
function parse<T = Record<string, unknown>>(reply: { content: { text: string }[]; shape?: T }): T {
  return JSON.parse(reply.content[0]?.text ?? 'null') as T
}

function summary(id: string, method: string, url: string, status = 200): RecordedCallSummary {
  return { id, sessionId: 's-1', runId: 'r-1', protocol: 'http', timestamp: 1_700_000_000_000 + Number(id.slice(1)), method, url, resourceType: 'fetch', status }
}

function detail(s: RecordedCallSummary): RecordedCallDetail {
  return {
    ...s,
    mimeType: 'application/json',
    durationMs: 12,
    request: { headers: [{ key: 'accept', value: 'application/json' }], query: [], body: null },
    response: { headers: [{ key: 'content-type', value: 'application/json' }], body: { encoding: 'utf8', data: '{"ok":true}', size: 11, truncated: false } }
  } as unknown as RecordedCallDetail
}

let mcp: FakeMcpService

beforeEach(() => {
  windowsState.length = 0
  broadcasts.length = 0
  tree.items = []
  tree.sessions.clear()
  tree.parents.clear()
  tree.versionBumps = 0
  folder.items = []
  nextId = 1
  captureState.status.clear()
  captureState.runs = []
  captureState.captures = []
  captureState.details.clear()
  captureState.filters.clear()
  captureState.applied = []
  treeReplaceSpy.mockClear()
  engineStop.mockClear()
  historyStored.mockClear()
  mcp = new FakeMcpService()
  registerRecordingTools(mcp as unknown as McpService)
})

describe('recording MCP tools', () => {
  it('registers the ten tools', () => {
    expect(mcp.names).toEqual([
      'list_recording_sessions', 'create_recording_session', 'update_recording_session', 'set_recording_filters',
      'start_recording', 'stop_recording', 'get_recording_status', 'list_recording_captures', 'get_recording_capture',
      'deduce_recording_routes'
    ])
  })

  it('create_recording_session validates, stores under the parent and broadcasts', async () => {
    const bad = await mcp.invoke('create_recording_session', { name: 'x', url: 'ftp://nope' })
    expect(bad.isError).toBe(true)
    const badRegex = await mcp.invoke('create_recording_session', { name: 'x', whitelist: ['('] })
    expect(badRegex.isError).toBe(true)
    expect(badRegex.content[0]?.text).toContain('invalid regex')
    const noParent = await mcp.invoke('create_recording_session', { name: 'x', parentId: 'missing' })
    expect(noParent.isError).toBe(true)

    const reply = parse(await mcp.invoke('create_recording_session', {
      parentId: 'env-1', name: 'Petstore rec', url: 'http://localhost:8080/', protocols: ['http', 'graphql'], blacklist: ['\\.png$']
    }))
    expect(reply).toMatchObject({ id: 's-1', name: 'Petstore rec', parentId: 'env-1', url: 'http://localhost:8080/', protocols: ['http', 'graphql'], blacklist: ['\\.png$'], state: 'idle', routeCount: 0 })
    expect(folder.items).toHaveLength(1)
    expect(treeReplaceSpy).toHaveBeenCalledTimes(1)
    expect(broadcasts.filter((b) => b.channel === 'file:autosave-trigger')).toHaveLength(0) // no window → nothing to send, no throw

    const listed = parse<{ count: number; sessions: { id: string; parentId: string | null }[] }>(await mcp.invoke('list_recording_sessions'))
    expect(listed.count).toBe(1)
    expect(listed.sessions[0]).toMatchObject({ id: 's-1', parentId: 'env-1' })
  })

  it('update_recording_session patches fields and pushes a protocol change to the live filters', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec', url: 'http://a/' }))
    const nothing = await mcp.invoke('update_recording_session', { sessionId: 's-1' })
    expect(nothing.isError).toBe(true)
    const updated = parse(await mcp.invoke('update_recording_session', { sessionId: 's-1', name: 'renamed', protocols: ['websocket'] }))
    expect(updated).toMatchObject({ name: 'renamed', protocols: ['websocket'], url: 'http://a/' })
    expect(captureState.filters.get('s-1')).toEqual({ protocols: ['websocket'], whitelist: [], blacklist: [] })
  })

  it('set_recording_filters replaces the given lists and can prune the existing captures', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec', whitelist: ['api'] }))
    captureState.applied = ['c1', 'c2']
    const reply = parse(await mcp.invoke('set_recording_filters', { sessionId: 's-1', blacklist: ['health'], applyToExisting: true }))
    expect(reply).toMatchObject({ whitelist: ['api'], blacklist: ['health'], removedCaptures: 2 })
    expect(captureState.filters.get('s-1')).toEqual({ protocols: ['http', 'websocket', 'graphql', 'grpc-web'], whitelist: ['api'], blacklist: ['health'] })
    const none = await mcp.invoke('set_recording_filters', { sessionId: 's-1' })
    expect(none.isError).toBe(true)
  })

  it('start_recording refuses a session without url, otherwise asks the renderer and waits for the engine', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec' }))
    const noUrl = await mcp.invoke('start_recording', { sessionId: 's-1' })
    expect(noUrl.isError).toBe(true)
    expect(noUrl.content[0]?.text).toContain('no recordable url')

    parse(await mcp.invoke('update_recording_session', { sessionId: 's-1', url: 'http://localhost:9999/' }))
    addWindow(7)
    const pending = mcp.invoke('start_recording', { sessionId: 's-1' })
    await Promise.resolve()
    const ask = broadcasts.find((b) => b.channel === 'mcp:start-recording')
    expect(ask).toBeDefined()
    const { requestId } = ask?.payload as { requestId: string; sessionId: string }
    expect((ask?.payload as { sessionId: string }).sessionId).toBe('s-1')
    // The renderer accepts, then the engine attaches a moment later.
    emitIpcMain('mcp:start-recording-result', 7, { requestId, accepted: true })
    setTimeout(() => {
      captureState.status.set('s-1', { sessionId: 's-1', state: 'recording', runId: 'r-1', tabId: 'recording-node-id:s-1:browser', captureCount: 0 })
    }, 150)
    const reply = parse<{ started: boolean; status: RecordingStatus }>(await pending)
    expect(reply.started).toBe(true)
    expect(reply.status.state).toBe('recording')

    // Already recording → no second handshake, plain status.
    broadcasts.length = 0
    const again = parse<{ started: boolean; alreadyRecording: boolean }>(await mcp.invoke('start_recording', { sessionId: 's-1' }))
    expect(again).toMatchObject({ started: false, alreadyRecording: true })
    expect(broadcasts.some((b) => b.channel === 'mcp:start-recording')).toBe(false)
  })

  it('start_recording reports an explicit error when every window declines', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec', url: 'http://localhost:9999/' }))
    addWindow(1)
    addWindow(2)
    // Decline from both windows on every round until the (shortened) budget runs out.
    const declineAll = (): void => {
      for (const b of broadcasts.splice(0)) {
        if (b.channel !== 'mcp:start-recording') continue
        const { requestId } = b.payload as { requestId: string }
        emitIpcMain('mcp:start-recording-result', 1, { requestId, accepted: false })
        emitIpcMain('mcp:start-recording-result', 2, { requestId, accepted: false })
      }
    }
    const { startRecordingViaRenderer } = await import('./recording')
    const pending = startRecordingViaRenderer('s-1', 350)
    const timer = setInterval(declineAll, 20)
    const result = await pending
    clearInterval(timer)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no window accepted')
  })

  it('stop_recording stops the engine and tells the renderer to close the browser tab', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec', url: 'http://a/' }))
    captureState.status.set('s-1', { sessionId: 's-1', state: 'recording', runId: 'r-1', tabId: 't', captureCount: 2 })
    addWindow(3)
    const reply = parse<{ stopped: boolean; status: RecordingStatus }>(await mcp.invoke('stop_recording', { sessionId: 's-1' }))
    expect(reply.stopped).toBe(true)
    expect(reply.status.state).toBe('idle')
    expect(engineStop).toHaveBeenCalledWith('s-1')
    expect(broadcasts.some((b) => b.channel === 'mcp:stop-recording' && (b.payload as { sessionId: string }).sessionId === 's-1')).toBe(true)
    const idle = parse<{ stopped: boolean }>(await mcp.invoke('stop_recording', { sessionId: 's-1' }))
    expect(idle.stopped).toBe(false)
  })

  it('list_recording_captures filters and keeps the most recent n; get_recording_capture returns the detail', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec' }))
    captureState.captures = [summary('c1', 'GET', 'http://a/api/pets'), summary('c2', 'GET', 'http://a/api/pets/1'), summary('c3', 'POST', 'http://a/api/pets', 201)]
    const second = captureState.captures[1]
    if (!second) throw new Error('fixture needs three captures')
    captureState.details.set('c2', detail(second))
    const all = parse<{ count: number; totalAvailable: number; captures: { id: string }[] }>(await mcp.invoke('list_recording_captures', { sessionId: 's-1' }))
    expect(all.count).toBe(3)
    const last = parse<{ count: number; totalAvailable: number; captures: { id: string }[] }>(await mcp.invoke('list_recording_captures', { sessionId: 's-1', limit: 2 }))
    expect(last.captures.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(last.totalAvailable).toBe(3)
    const missing = await mcp.invoke('get_recording_capture', { sessionId: 's-1', captureId: 'nope' })
    expect(missing.isError).toBe(true)
    const one = parse<RecordedCallDetail>(await mcp.invoke('get_recording_capture', { sessionId: 's-1', captureId: 'c2' }))
    expect(one.id).toBe('c2')
    expect(one.response?.body).toMatchObject({ encoding: 'utf8' })
  })

  it('deduce_recording_routes needs captures, then merges the routes into the session and writes the history', async () => {
    parse(await mcp.invoke('create_recording_session', { name: 'rec', url: 'http://a/' }))
    const empty = await mcp.invoke('deduce_recording_routes', { sessionId: 's-1' })
    expect(empty.isError).toBe(true)

    captureState.captures = [summary('c1', 'GET', 'http://a/api/pets'), summary('c2', 'GET', 'http://a/api/pets/1'), summary('c3', 'GET', 'http://a/api/pets/2')]
    for (const c of captureState.captures) captureState.details.set(c.id, detail(c))
    const reply = parse<{ routes: number; newRoutes: number; folders: number; created: { kind: string; name: string }[]; historyEntries: number }>(
      await mcp.invoke('deduce_recording_routes', { sessionId: 's-1' })
    )
    expect(reply.routes).toBe(2)
    expect(reply.newRoutes).toBe(2)
    expect(reply.created).toHaveLength(1)
    expect(reply.created[0]).toMatchObject({ name: 'api', kind: 'folder', parentId: 's-1' })
    expect(reply.historyEntries).toBe(3)
    expect(historyStored).toHaveBeenCalledTimes(1)
    expect(tree.sessions.get('s-1')?.items).toHaveLength(1)
    expect(treeReplaceSpy).toHaveBeenCalled()
    expect(tree.versionBumps).toBeGreaterThan(0)

    // Second deduction: nothing new, nothing rewritten.
    historyStored.mockClear()
    const again = parse<{ newRoutes: number; created: unknown[] }>(await mcp.invoke('deduce_recording_routes', { sessionId: 's-1' }))
    expect(again.newRoutes).toBe(0)
    expect(again.created).toEqual([])
    expect(historyStored).not.toHaveBeenCalled()
  })
})
