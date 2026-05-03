import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

// ---------------------------------------------------------------------------
// Test scaffolding: a fake McpService that captures every tool the
// production code registers, plus a hand-built collectionStore + context
// + search mock seeded from per-test fixtures. Handlers are exercised
// directly so we assert on the wire shape without spinning the SDK or a
// real HTTP server up.
// ---------------------------------------------------------------------------

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* not used in read.test */ }
  invoke(name: string, args: Record<string, unknown> = {}): unknown {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {})
  }
  has(name: string): boolean {
    return this.handlers.has(name)
  }
}

// Mocks: bind these to mutable refs so each `describe` block can swap
// in its own fixture without re-mocking modules.
const mockState = {
  findById: vi.fn<(id: string) => unknown>(),
  getCollections: vi.fn<() => unknown[]>(),
  serializeRequest: vi.fn<(r: unknown) => Record<string, unknown>>(),
  getContext: vi.fn<(envId: string) => { variables: Record<string, string> } | undefined>(),
  search: vi.fn<(q: string) => { category: string; items: { id: string; title: string; category: string; description?: string; score: number }[] }[]>()
}

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id),
    getCollections: () => mockState.getCollections(),
    serializeRequest: (r: unknown) => mockState.serializeRequest(r)
  }
}))

vi.mock('../../services/ContextService', () => ({
  contextService: {
    getContext: (id: string) => mockState.getContext(id)
  }
}))

vi.mock('electron-core-ui/main', () => ({
  searchService: {
    search: (q: string) => mockState.search(q)
  }
}))

vi.mock('./activeState', () => ({
  getCurrentTabSnapshot: () => ({ tabId: 'tab-1', itemId: 'item-1', kind: 'request' as const }),
  pickSelectedEnvId: () => null
}))

// Imported after mocks are in place.
import { registerReadTools } from './read'

interface ReplyText { content: { type: 'text'; text: string }[]; isError?: true }
function parseReply(reply: unknown): { text: string; isError: boolean; payload: unknown } {
  const r = reply as ReplyText
  const text = r.content[0]?.text ?? ''
  let payload: unknown = null
  try { payload = JSON.parse(text) } catch { payload = text }
  return { text, isError: r.isError === true, payload }
}

beforeEach(() => {
  for (const fn of Object.values(mockState)) fn.mockReset()
})

describe('read tools — list_folders', () => {
  it('lists every folder in the project (no parentId)', () => {
    const root = { id: 'root', name: 'root', folderType: 'environment', items: [
      { id: 'mid', name: 'mid', configuration: {}, items: [] }
    ], configuration: {}, environments: [] }
    mockState.getCollections.mockReturnValue([root])
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload, isError } = parseReply(mcp.invoke('list_folders'))
    expect(isError).toBe(false)
    expect(payload).toEqual([
      { id: 'root', name: 'root', kind: 'env-folder', parentId: null },
      { id: 'mid', name: 'mid', kind: 'folder', parentId: 'root' }
    ])
  })

  it('lists direct subfolder children when parentId is given', () => {
    const sub = { id: 'sub', name: 'sub', configuration: {}, items: [] }
    const folder = { id: 'a', name: 'A', configuration: {}, items: [sub] }
    mockState.findById.mockReturnValue(folder)
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('list_folders', { parentId: 'a' }))
    expect(payload).toEqual([{ id: 'sub', name: 'sub', kind: 'folder', parentId: 'a' }])
  })

  it('returns isError when parentId points at a request, not a folder', () => {
    mockState.findById.mockReturnValue({ id: 'r', name: 'r', type: 'http' })
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('list_folders', { parentId: 'r' }))
    expect(isError).toBe(true)
    expect(text).toContain('not a folder')
  })

  it('returns isError when parentId is unknown', () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('list_folders', { parentId: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('unknown')
  })
})

describe('read tools — list_requests', () => {
  it('lists requests at a folder', () => {
    const folder = { id: 'a', name: 'A', configuration: {}, items: [
      { id: 'r1', name: 'r1', type: 'http', method: 'GET' }
    ] }
    mockState.findById.mockReturnValue(folder)
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('list_requests', { folderId: 'a' }))
    expect(payload).toEqual([{ id: 'r1', name: 'r1', protocol: 'http', method: 'GET', parentId: 'a' }])
  })
})

describe('read tools — get_request', () => {
  it('returns the serialised request payload (PasswordValue masking happens in serializeRequest)', () => {
    const fakeReq = { id: 'r1', name: 'r1', type: 'http' }
    mockState.findById.mockReturnValue(fakeReq)
    // Simulate what CollectionStore.serializeRequest produces — the
    // password field comes back as `{type:'password'}` (PasswordValue.toJSON)
    // rather than the original plaintext, proving the masking runs
    // before the tool reply. We assert the tool returns the masked
    // form unchanged — no double-serialisation that could re-leak.
    mockState.serializeRequest.mockReturnValue({
      id: 'r1',
      name: 'r1',
      type: 'http',
      headers: [{ key: 'Authorization', value: { type: 'password' } }]
    })
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload, isError } = parseReply(mcp.invoke('get_request', { id: 'r1' }))
    expect(isError).toBe(false)
    expect(payload).toMatchObject({
      headers: [{ key: 'Authorization', value: { type: 'password' } }]
    })
    expect(JSON.stringify(payload)).not.toContain('plaintext-secret')
  })

  it('returns isError when id is empty', () => {
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('get_request', { id: '' }))
    expect(isError).toBe(true)
    expect(text).toContain('id is required')
  })

  it('returns isError when id matches a folder, not a request', () => {
    mockState.findById.mockReturnValue({ id: 'f', name: 'f', configuration: {}, items: [] })
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(mcp.invoke('get_request', { id: 'f' }))
    expect(isError).toBe(true)
    expect(text).toContain('not a request')
  })
})

describe('read tools — search', () => {
  beforeEach(() => {
    mockState.search.mockReturnValue([
      { category: 'request', items: [
        { id: 'r1', title: 'List users', category: 'request', score: 1, description: 'GET /users' },
        { id: 'r2', title: 'Create user', category: 'request', score: 0.8 }
      ] },
      { category: 'folder', items: [
        { id: 'f1', title: 'Users', category: 'folder', score: 0.5 }
      ] },
      { category: 'environment', items: [
        { id: 'e1', title: 'staging', category: 'environment', score: 0.3 }
      ] }
    ])
  })

  it('returns all kinds when `kinds` is omitted', () => {
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('search', { query: 'u' })) as { payload: { matchCount: number; matches: { category: string }[] } }
    expect(payload.matchCount).toBe(4)
    expect(payload.matches.map((m) => m.category)).toEqual(['request', 'request', 'folder', 'environment'])
  })

  it('respects the `kinds` filter', () => {
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('search', { query: 'u', kinds: ['request'] })) as { payload: { matchCount: number; matches: { category: string }[] } }
    expect(payload.matchCount).toBe(2)
    expect(payload.matches.every((m) => m.category === 'request')).toBe(true)
  })

  it('caps the result list at maxResults and flips `truncated`', () => {
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('search', { query: 'u', maxResults: 2 })) as { payload: { matchCount: number; truncated: boolean; matches: unknown[] } }
    expect(payload.matchCount).toBe(2)
    expect(payload.truncated).toBe(true)
  })

  it('returns isError on empty query', () => {
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { isError } = parseReply(mcp.invoke('search', { query: '' }))
    expect(isError).toBe(true)
  })
})

describe('read tools — get_active_env', () => {
  it('returns null env when the folder has no environments', () => {
    mockState.findById.mockReturnValue({
      id: 'ef', name: 'EF', folderType: 'environment',
      configuration: {}, items: [], environments: []
    })
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('get_active_env', { envFolderId: 'ef' }))
    expect(payload).toEqual({ envFolderId: 'ef', selectedEnvId: null, selectedEnvName: null, variables: [] })
  })

  it('falls back to the first env when nothing is selected', () => {
    mockState.findById.mockReturnValue({
      id: 'ef', name: 'EF', folderType: 'environment',
      configuration: {}, items: [],
      environments: [
        { id: 'env-A', name: 'staging', variables: [{ key: 'host', value: 'http://stg' }] },
        { id: 'env-B', name: 'prod', variables: [] }
      ]
    })
    mockState.getContext.mockReturnValue({ variables: { host: 'http://stg' } })
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('get_active_env', { envFolderId: 'ef' })) as { payload: { selectedEnvId: string; selectedEnvName: string; variables: { key: string; resolved: string }[] } }
    expect(payload.selectedEnvId).toBe('env-A')
    expect(payload.selectedEnvName).toBe('staging')
    expect(payload.variables).toContainEqual({ key: 'host', value: 'http://stg', resolved: 'http://stg' })
  })

  it('returns isError when target is not an env-folder', () => {
    mockState.findById.mockReturnValue({ id: 'r', name: 'r', type: 'http' })
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { isError } = parseReply(mcp.invoke('get_active_env', { envFolderId: 'r' }))
    expect(isError).toBe(true)
  })
})

describe('read tools — get_current_tab', () => {
  it('returns the active state cache snapshot', () => {
    const mcp = new FakeMcpService()
    registerReadTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('get_current_tab'))
    expect(payload).toEqual({ tabId: 'tab-1', itemId: 'item-1', kind: 'request' })
  })
})
