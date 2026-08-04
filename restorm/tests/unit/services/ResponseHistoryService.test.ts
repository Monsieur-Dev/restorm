import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  ResponseHistoryDetail
} from '../../../src/shared/types/collections'

vi.mock('fs', () => {
  const m = {
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    promises: { readFile: vi.fn(), writeFile: vi.fn() },
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    unlinkSync: vi.fn(),
    accessSync: vi.fn(),
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }
  }
  return { ...m, default: m }
})

vi.mock('crypto', () => {
  let c = 0
  const m = { randomUUID: vi.fn(() => { c++; return 'guid-' + String(c).padStart(4, '0') }) }
  return { ...m, default: m }
})

vi.mock('@zip.js/zip.js', () => ({
  configure: vi.fn(), TextReader: vi.fn(), TextWriter: vi.fn(),
  Uint8ArrayReader: vi.fn(), Uint8ArrayWriter: vi.fn(),
  ZipReader: vi.fn().mockImplementation(() => ({
    getEntries: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined)
  })),
  ZipWriter: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(new Uint8Array(0))
  }))
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn(), on: vi.fn() }, app: { getPath: vi.fn() }
}))

vi.mock('electron-core-ui/main', () => ({
  eventBusService: { subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }), emit: vi.fn() },
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isFileServiceInitialized: vi.fn().mockReturnValue(true),
  getFileService: vi.fn().mockReturnValue({ getFilePath: vi.fn().mockReturnValue('/tmp/test.json') }),
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  serializeWithDecorators: vi.fn()
}))

vi.mock('../../../src/main/services/CollectionStore', () => ({
  collectionStore: { getCollections: vi.fn(() => []), findById: vi.fn() }
}))
vi.mock('../../../src/main/services/ContextService', () => ({
  contextService: {
    getResolvedUrl: vi.fn().mockReturnValue({ resolvedUrl: 'https://api.test.com/resource' }),
    resolveUrlForRequest: vi.fn().mockReturnValue({ resolvedUrl: 'https://api.test.com/resource' }),
    getRequestContext: vi.fn().mockReturnValue({ fullData: { method: 'GET' }, keyValueGroups: new Map() }),
    resolveValue: vi.fn((v: string) => v),
    // Type-aware value resolution (mirrors the live dispatch path — only an
    // `ExpressionValue` row substitutes). Test fixtures pass plain
    // `{ key, value }` KeyValue-shaped rows; unwrap `.value` the same way the
    // real gate falls back for a non-class-instance value.
    resolveKeyValueForRequest: vi.fn((kv: { value: unknown }) => {
      const raw = typeof kv.value === 'string' ? kv.value : String(kv.value)
      return raw
    })
  }
}))
vi.mock('../../../src/main/services/DocumentEvents', () => ({
  DocumentEvents: { REQUEST_DELETED: 'document:request:deleted' }
}))
vi.mock('../../../src/shared/models', () => ({
  isAnyFolder: vi.fn((i: Record<string, unknown>) => 'items' in i),
  isRequest: vi.fn((i: Record<string, unknown>) => 'type' in i && !('items' in i))
}))

// The service delegates all archive I/O to the shared `historyArchive` module
// (read / write / serialized write-queue), so the test drives a store-backed
// stand-in for that module rather than the on-disk zip.
vi.mock('../../../src/main/services/historyArchive', () => ({
  getHistoryArchivePath: vi.fn(),
  readHistoryArchive: vi.fn(),
  writeHistoryArchive: vi.fn(),
  queueHistoryWrite: vi.fn(),
  INDEX_FILE_NAME: 'index.json',
  RESPONSES_FOLDER: 'responses',
  SCENARIO_RUNS_FOLDER: 'scenarioRuns'
}))

import { responseHistoryService } from '../../../src/main/services/ResponseHistoryService'
import { existsSync } from 'fs'
import { isFileServiceInitialized, getFileService } from 'electron-core-ui/main'
import { collectionStore } from '../../../src/main/services/CollectionStore'
import { contextService } from '../../../src/main/services/ContextService'
import {
  getHistoryArchivePath,
  readHistoryArchive,
  writeHistoryArchive,
  queueHistoryWrite,
  type HistoryArchiveIndex
} from '../../../src/main/services/historyArchive'

interface SI {
  initialized: boolean
  subscriptions: { unsubscribe: () => void }[]
}

const svc = responseHistoryService as unknown as SI
const mockedContextService = vi.mocked(contextService)
const AP = '/tmp/test.json.responses.zip'
let store: Map<string, Map<string, string>>

function setA(path: string, idx: HistoryArchiveIndex, entries: Map<string, string>): void {
  const d = new Map<string, string>()
  d.set('index.json', JSON.stringify(idx))
  for (const [k, v] of entries) d.set(k, v)
  store.set(path, d)
}
function getIdx(path: string): HistoryArchiveIndex | null {
  const r = store.get(path)?.get('index.json')
  return r ? (JSON.parse(r) as HistoryArchiveIndex) : null
}
function mkD(o: Partial<ResponseHistoryDetail> = {}): ResponseHistoryDetail {
  return {
    guid: o.guid ?? 'g', requestId: o.requestId ?? 'req-1',
    type: o.type ?? 'http',
    success: o.success ?? true, timestamp: o.timestamp ?? '2026-01-15T10:00:00.000Z',
    pinned: o.pinned ?? false,
    response: o.response ?? {
      type: 'http' as const, requestUrl: 'https://api.test.com/resource', requestMethod: 'GET',
      requestHeaders: [], requestParams: [], requestPathParams: [],
      statusCode: 200, statusText: 'OK', responseHeaders: [], responseBody: '{"ok":true}',
      timings: { startedAt: '2026-01-15T10:00:00.000Z', durationMs: 150 }
    }
  }
}
// `_rp` retained as the first arg for call-site readability (a path-shaped
// label e.g. "C/R") even though the v2 index is requestId-keyed.
function seed(_rp: string, es: { guid: string; timestamp: string; pinned?: boolean; success?: boolean; requestId?: string }[]): void {
  // Bucket entries by requestId — v2 schema. Tests that don't set
  // requestId default to 'req-1' so the lookup keeps working.
  const buckets = new Map<string, typeof es>()
  for (const e of es) {
    const id = e.requestId ?? 'req-1'
    const list = buckets.get(id) ?? []
    list.push(e)
    buckets.set(id, list)
  }
  const idx: HistoryArchiveIndex = {
    version: 2,
    requests: [...buckets.entries()].map(([requestId, list]) => ({
      requestId,
      entries: list.map((e) => ({ guid: e.guid, timestamp: e.timestamp, pinned: e.pinned ?? false, success: e.success ?? true }))
    })),
    scenarios: []
  }
  const de = new Map<string, string>()
  for (const e of es) de.set('responses/' + e.guid + '.json', JSON.stringify(mkD({ guid: e.guid, requestId: e.requestId ?? 'req-1', timestamp: e.timestamp, pinned: e.pinned ?? false, success: e.success ?? true })))
  setA(AP, idx, de)
}
function setupCols(): void {
  const c = [{ id: 'col-1', name: 'My Collection', items: [{ id: 'req-1', name: 'My Request', type: 'http', method: 'GET' }] }]
  vi.mocked(collectionStore.getCollections).mockReturnValue(c as never)
  vi.mocked(collectionStore.findById).mockImplementation((id: string) => {
    for (const col of c) for (const item of col.items) if ((item as { id: string }).id === id) return item as never
    return null as never
  })
}
function patch(): void {
  vi.mocked(existsSync).mockImplementation((p) => store.has(String(p)))
  // Mirror the real path resolver: no archive path until the file service is
  // initialized (so "skips when not initialized" still short-circuits).
  vi.mocked(getHistoryArchivePath).mockImplementation(() => (vi.mocked(isFileServiceInitialized)() ? AP : null))
  // The real queue serializes writes; for the test just run the callback.
  vi.mocked(queueHistoryWrite).mockImplementation((fn) => fn())
  vi.mocked(readHistoryArchive).mockImplementation((p: string) => {
    const d = store.get(p)
    if (!d) return Promise.resolve({ index: { version: 2 as const, requests: [], scenarios: [] }, entriesData: new Map<string, string>() })
    const it = d.get('index.json')
    const idx: HistoryArchiveIndex = it ? (JSON.parse(it) as HistoryArchiveIndex) : { version: 2, requests: [], scenarios: [] }
    const ed = new Map<string, string>()
    for (const [k, v] of d) ed.set(k, v)
    return Promise.resolve({ index: idx, entriesData: ed })
  })
  vi.mocked(writeHistoryArchive).mockImplementation((p: string, idx: HistoryArchiveIndex, ed: Map<string, string>) => {
    const d = new Map<string, string>()
    d.set('index.json', JSON.stringify(idx))
    for (const [k, v] of ed) { if (k !== 'index.json') d.set(k, v) }
    store.set(p, d)
    return Promise.resolve()
  })
}
function mkHttp(ts: string): { requestId: string; success: boolean; statusCode: number; statusText: string; headers: Record<string, string | string[]>; body: string; timings: { startedAt: string; durationMs: number }; requestUrl: string } {
  return { requestId: 'req-1', success: true, statusCode: 200, statusText: 'OK', headers: {} as Record<string, string | string[]>, body: '', timings: { startedAt: ts, durationMs: 50 }, requestUrl: '' }
}

describe('ResponseHistoryService', () => {
  beforeEach(() => {
    store = new Map()
    svc.initialized = false
    svc.subscriptions = []
    vi.mocked(isFileServiceInitialized).mockReturnValue(true)
    vi.mocked(getFileService).mockReturnValue({ getFilePath: vi.fn().mockReturnValue('/tmp/test.json') } as never)
    vi.mocked(collectionStore.getCollections).mockReturnValue([] as never)
    vi.mocked(collectionStore.findById).mockReturnValue(null as never)
    patch()
  })

  it('list empty', async () => {
    expect(await responseHistoryService.list('req-1')).toEqual([])
  })

  it('list sorted', async () => {
    seed('C/R', [
      { guid: 'a', timestamp: '2026-01-15T10:00:00.000Z' },
      { guid: 'b', timestamp: '2026-01-15T12:00:00.000Z' }
    ])
    const r = await responseHistoryService.list('req-1')
    expect(r).toHaveLength(2)
    expect(r[0]?.guid).toBe('b')
  })

  it('detail found', async () => {
    seed('C/R', [{ guid: 'g1', timestamp: '2026-01-15T10:00:00.000Z' }])
    const r = await responseHistoryService.getDetail('g1')
    expect(r).not.toBeNull()
    expect(r?.guid).toBe('g1')
  })

  it('list filters by requestId', async () => {
    seed('C/R', [
      { guid: 'a', timestamp: '2026-01-15T10:00:00.000Z', requestId: 'req-1' },
      { guid: 'b', timestamp: '2026-01-15T11:00:00.000Z', requestId: 'req-2' }
    ])
    expect(await responseHistoryService.list('req-1')).toHaveLength(1)
  })

  it('getDetail null for unknown', async () => {
    seed('C/R', [{ guid: 'g1', timestamp: '2026-01-15T10:00:00.000Z' }])
    expect(await responseHistoryService.getDetail('x')).toBeNull()
  })

  it('togglePin pins entry', async () => {
    seed('C/R', [
      { guid: 'p', timestamp: '2026-01-15T10:00:00.000Z', pinned: false }
    ])
    expect(await responseHistoryService.togglePin('p', true)).toBe(true)
    const idx = getIdx(AP)
    expect(idx?.requests[0]?.entries[0]?.pinned).toBe(true)
  })

  it('togglePin returns false for unknown', async () => {
    seed('C/R', [{ guid: 'o', timestamp: '2026-01-15T10:00:00.000Z' }])
    expect(await responseHistoryService.togglePin('x', true)).toBe(false)
  })

  it('storeExecutionResult stores HTTP result', async () => {
    setupCols()
    await responseHistoryService.storeExecutionResult(
      'req-1', 'http', mkHttp('2026-01-15T10:00:00.000Z')
    )
    const idx = getIdx(AP)
    expect(idx?.requests[0]?.entries).toHaveLength(1)
  })

  it('storeExecutionResult echoes requestHeaders resolved exactly like the live dispatch: KEY unconditional, VALUE type-aware', async () => {
    setupCols()
    const defaultGetRequestContext = mockedContextService.getRequestContext.getMockImplementation()
    const defaultResolveValue = mockedContextService.resolveValue.getMockImplementation()
    const defaultResolveKeyValueForRequest = mockedContextService.resolveKeyValueForRequest.getMockImplementation()
    try {
      mockedContextService.getRequestContext.mockReturnValue({
        fullData: { method: 'GET' },
        keyValueGroups: new Map([['headers', [
          // KEY has no ValueType to gate on — resolves unconditionally.
          { key: '{{headerNameVar}}', value: 'plain-value', enabled: true },
          // VALUE only substitutes when explicitly typed as an expression.
          { key: 'X-Templated-Value', value: { type: 'expression', value: '{{tokenVar}}' }, enabled: true }
        ]]])
      } as never)
      mockedContextService.resolveValue.mockImplementation((v: string) => v.replace('{{headerNameVar}}', 'X-Templated-Key'))
      mockedContextService.resolveKeyValueForRequest.mockImplementation((kv) => {
        if (typeof kv.value === 'object' && 'type' in kv.value) {
          const typed = kv.value as { type: string; value: string }
          return typed.type === 'expression' ? typed.value.replace('{{tokenVar}}', 'resolved-token') : typed.value
        }
        return String(kv.value)
      })

      await responseHistoryService.storeExecutionResult('req-1', 'http', mkHttp('2026-01-15T10:00:01.000Z'))

      const idx = getIdx(AP)
      const guid = idx?.requests[0]?.entries[0]?.guid
      expect(guid).toBeDefined()
      const detailText = store.get(AP)?.get(`responses/${String(guid)}.json`)
      const parsed = JSON.parse(detailText ?? '{}') as ResponseHistoryDetail
      if (parsed.response.type !== 'http') throw new Error('expected http response')
      expect(parsed.response.requestHeaders).toEqual([
        { key: 'X-Templated-Key', value: 'plain-value', enabled: true },
        { key: 'X-Templated-Value', value: 'resolved-token', enabled: true }
      ])
    } finally {
      // This file's `beforeEach` doesn't reset mocks between tests (no
      // `vi.clearAllMocks`), so a persistent `mockImplementation` override
      // would otherwise leak into every later test in the file.
      if (defaultGetRequestContext) mockedContextService.getRequestContext.mockImplementation(defaultGetRequestContext)
      if (defaultResolveValue) mockedContextService.resolveValue.mockImplementation(defaultResolveValue)
      if (defaultResolveKeyValueForRequest) mockedContextService.resolveKeyValueForRequest.mockImplementation(defaultResolveKeyValueForRequest)
    }
  })

  it('storeExecutionResult skips when not initialized', async () => {
    setupCols()
    vi.mocked(isFileServiceInitialized).mockReturnValueOnce(false)
    await responseHistoryService.storeExecutionResult(
      'req-1', 'http', mkHttp('2026-01-15T10:00:00.000Z')
    )
    expect(store.size).toBe(0)
  })

  it('storeExecutionResult captures OData annotations from response body', async () => {
    setupCols()
    const odataBody = JSON.stringify({
      '@odata.context': 'https://api.test.com/$metadata#Pets',
      '@odata.count': 42,
      '@odata.nextLink': 'https://api.test.com/Pets?$skip=10',
      value: [{ Id: 1, Name: 'Rex' }]
    })
    const result = {
      requestId: 'req-1', success: true, statusCode: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json; odata.metadata=minimal' } as Record<string, string | string[]>,
      body: odataBody,
      timings: { startedAt: '2026-01-15T10:00:00.000Z', durationMs: 50 },
      requestUrl: 'https://api.test.com/Pets?$count=true'
    }
    await responseHistoryService.storeExecutionResult('req-1', 'odata', result)
    const idx = getIdx(AP)
    const guid = idx?.requests[0]?.entries[0]?.guid
    expect(guid).toBeDefined()
    const detailText = store.get(AP)?.get(`responses/${String(guid)}.json`)
    expect(detailText).toBeDefined()
    const parsed = JSON.parse(detailText ?? '{}') as ResponseHistoryDetail
    expect(parsed.type).toBe('odata')
    if (parsed.response.type !== 'odata') throw new Error('expected odata response')
    expect(parsed.response.odataCount).toBe(42)
    expect(parsed.response.odataNextLink).toBe('https://api.test.com/Pets?$skip=10')
    expect(parsed.response.odataVersion).toBe('v4')
    expect(parsed.response.operationKind).toBe('entity-set')
  })

  it('storeExecutionResult preserves @odata.deltaLink for later replay', async () => {
    setupCols()
    const deltaBody = JSON.stringify({
      '@odata.context': 'https://api.test.com/$metadata#Pets/$delta',
      '@odata.deltaLink': 'https://api.test.com/Pets?$deltatoken=abc123',
      value: [{ Id: 1, Name: 'Rex' }, { '@removed': { reason: 'deleted' }, Id: 2 }]
    })
    const result = {
      requestId: 'req-1', success: true, statusCode: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json; odata.metadata=minimal' } as Record<string, string | string[]>,
      body: deltaBody,
      timings: { startedAt: '2026-01-15T10:00:00.000Z', durationMs: 50 },
      requestUrl: 'https://api.test.com/Pets/$delta'
    }
    await responseHistoryService.storeExecutionResult('req-1', 'odata', result)
    const idx = getIdx(AP)
    const guid = idx?.requests[0]?.entries[0]?.guid
    const detailText = store.get(AP)?.get(`responses/${String(guid)}.json`)
    const parsed = JSON.parse(detailText ?? '{}') as ResponseHistoryDetail
    if (parsed.response.type !== 'odata') throw new Error('expected odata response')
    expect(parsed.response.odataDeltaLink).toBe('https://api.test.com/Pets?$deltatoken=abc123')
  })

})
