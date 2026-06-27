import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Activation, ExecContext } from '../types'
import type { ScenarioNode } from '../../../shared/types/scenario'

/**
 * AC: "Request — un slot câblé court-circuite la résolution ; sinon
 * résolution classique env + Handlebars."
 *
 * The executor leans on the real HTTP pipeline (CollectionStore +
 * HTTPExecutionService + history) — all mocked here so the test stays a
 * pure unit. What we assert is the slot short-circuit contract: the
 * request that gets flushed to the resolution context (env + Handlebars)
 * carries WIRED slot values overridden, while UNWIRED slots pass through
 * untouched so classic resolution still applies to them.
 */

const findById = vi.fn<(id: string) => unknown>()
const execute = vi.fn<(i: unknown) => Promise<unknown>>()
const cancel = vi.fn<(id: string) => void>()
const storeExecutionResult = vi.fn<(...a: unknown[]) => Promise<void>>()
const flushRequestStateToContext = vi.fn<(r: unknown) => void>()

vi.mock('../../services/CollectionStore', () => ({ collectionStore: { findById: (id: string) => findById(id) } }))
vi.mock('../../services/HTTPExecutionService', () => ({
  httpExecutionService: { execute: (i: unknown) => execute(i), cancel: (id: string) => { cancel(id) } }
}))
vi.mock('../../services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: (...a: unknown[]) => storeExecutionResult(...a) }
}))
vi.mock('../../mcp/tools/execute', () => ({ flushRequestStateToContext: (r: unknown) => { flushRequestStateToContext(r) } }))

// Import AFTER the mocks are registered.
const { httpRequestExecutor, applyRequestOverride } = await import('./httpRequestExecutor')

interface KV { key: string; value?: unknown; enabled?: boolean }

/** A persisted HTTP request with one path-param `name=Glaude` and one
 * header `X-Env={{token}}` so we can prove wired slots win + unwired
 * slots survive for classic resolution. */
function makeRequest(): Record<string, unknown> {
  return {
    id: 'req-1',
    type: 'http',
    method: 'POST',
    pathParams: [{ key: 'name', value: 'Glaude', enabled: true }] as KV[],
    headers: [{ key: 'X-Env', value: '{{token}}', enabled: true }] as KV[],
    params: [] as KV[],
    body: '{"persisted":true}'
  }
}

function cannedResult(): Record<string, unknown> {
  return {
    success: true,
    statusCode: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    requestUrl: 'https://api.test/my/Bob/action',
    requestHeaders: {},
    timings: { startedAt: '2026-01-01T00:00:00.000Z', durationMs: 12 }
  }
}

function makeCtx(node: ScenarioNode): ExecContext {
  return {
    signal: new AbortController().signal,
    log: () => undefined,
    variables: new Map(),
    runSubScenario: () => Promise.reject(new Error('not wired')),
    requestUserInput: () => Promise.reject(new Error('not wired')),
    node
  }
}

function makeActivation(inputs: Record<string, unknown>): Activation {
  return { nodeId: 'n1', kind: 'httpRequest' as Activation['kind'], scope: [], inputs }
}

function node(): ScenarioNode {
  return { id: 'n1', kind: 'httpRequest', config: { requestId: 'req-1' }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
}

beforeEach(() => {
  findById.mockReset().mockReturnValue(makeRequest())
  execute.mockReset().mockResolvedValue(cannedResult())
  cancel.mockReset()
  storeExecutionResult.mockReset().mockResolvedValue(undefined)
  flushRequestStateToContext.mockReset()
})

describe('httpRequestExecutor — slot short-circuit', () => {
  it('a wired slot overrides the persisted value before resolution', async () => {
    await httpRequestExecutor(
      makeActivation({ 'pathParams:name': 'Bob', 'headers:X-Test': 'hdr', body: { a: 1 } }),
      makeCtx(node())
    )

    // The request flushed to the env/Handlebars resolution context is the
    // OVERRIDDEN clone — the wired slots short-circuit the persisted values.
    expect(flushRequestStateToContext).toHaveBeenCalledTimes(1)
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { pathParams: KV[]; headers: KV[]; body: unknown }
    expect(flushed.pathParams.find((kv) => kv.key === 'name')?.value).toBe('Bob')
    // A wired header slot that didn't exist on the request is appended.
    expect(flushed.headers.find((kv) => kv.key === 'X-Test')?.value).toBe('hdr')
    // Objects are wire-stringified for KV slots; `body` keeps its raw value.
    expect(flushed.body).toEqual({ a: 1 })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('a wired whole-object headers slot merges each entry into the table', async () => {
    await httpRequestExecutor(
      makeActivation({ headers: { 'X-A': '1', 'X-Env': 'replaced' } }),
      makeCtx(node())
    )

    expect(flushRequestStateToContext).toHaveBeenCalledTimes(1)
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { headers: KV[] }
    // A new key from the object is appended.
    expect(flushed.headers.find((kv) => kv.key === 'X-A')?.value).toBe('1')
    // A key the request already defines is updated in place.
    expect(flushed.headers.find((kv) => kv.key === 'X-Env')?.value).toBe('replaced')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('an inline JSON-string whole-object params slot merges into the table', async () => {
    const n = { id: 'n1', kind: 'httpRequest', config: { requestId: 'req-1', overrides: { params: '{"page":"2"}' } }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    await httpRequestExecutor(makeActivation({}), makeCtx(n))

    expect(flushRequestStateToContext).toHaveBeenCalledTimes(1)
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { params: KV[] }
    expect(flushed.params.find((kv) => kv.key === 'page')?.value).toBe('2')
  })

  it('leaves unwired slots untouched so classic env + Handlebars resolution still applies', async () => {
    const persisted = makeRequest()
    findById.mockReturnValue(persisted)

    await httpRequestExecutor(makeActivation({}), makeCtx(node()))

    expect(flushRequestStateToContext).toHaveBeenCalledTimes(1)
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0]
    // No wired slot → the executor flushes the request UNCHANGED (same ref),
    // so its `{{token}}` header + persisted path-param flow to the classic
    // resolution path exactly as a Send-button run would.
    expect(flushed).toBe(persisted)
    expect((persisted.pathParams as KV[]).find((kv) => kv.key === 'name')?.value).toBe('Glaude')
    expect((persisted.headers as KV[]).find((kv) => kv.key === 'X-Env')?.value).toBe('{{token}}')
  })

  it('does not mutate the persisted request when applying overrides', async () => {
    const persisted = makeRequest()
    findById.mockReturnValue(persisted)

    await httpRequestExecutor(makeActivation({ 'pathParams:name': 'Bob' }), makeCtx(node()))

    // The override lands on a clone; the persisted store entry is intact.
    expect((persisted.pathParams as KV[]).find((kv) => kv.key === 'name')?.value).toBe('Glaude')
  })

  it('emits the `response` port with the request + response envelope', async () => {
    const result = await httpRequestExecutor(makeActivation({}), makeCtx(node()))
    const out = result.outputs.find((o) => o.port === 'response')?.value as {
      request: { url: string; method: string }
      response: { status: number; success: boolean; body: string }
    }
    expect(out.request.url).toBe('https://api.test/my/Bob/action')
    expect(out.request.method).toBe('POST')
    expect(out.response.status).toBe(200)
    expect(out.response.success).toBe(true)
    expect(out.response.body).toBe('{"ok":true}')
  })

  it('marks `response.success` false on a 4xx/5xx status (status-class, not transport)', async () => {
    // The transport completed (the service reports `success: true`), but the
    // HTTP status is 500 — `response.success` must reflect the status class so
    // an `if`/`assert` on `.success` treats it as a failure.
    execute.mockResolvedValue({ ...cannedResult(), success: true, statusCode: 500, statusText: 'Internal Server Error' })
    const result = await httpRequestExecutor(makeActivation({}), makeCtx(node()))
    const out = result.outputs.find((o) => o.port === 'response')?.value as {
      response: { status: number; success: boolean }
    }
    expect(out.response.status).toBe(500)
    expect(out.response.success).toBe(false)

    // A 404 is likewise a failure.
    execute.mockResolvedValue({ ...cannedResult(), success: true, statusCode: 404, statusText: 'Not Found' })
    const r404 = await httpRequestExecutor(makeActivation({}), makeCtx(node()))
    const o404 = r404.outputs.find((o) => o.port === 'response')?.value as { response: { success: boolean } }
    expect(o404.response.success).toBe(false)
  })

  it('a wired `requestOverride` (pm.request mutation) merges over the bound request before dispatch', async () => {
    await httpRequestExecutor(
      makeActivation({ requestOverride: { url: 'https://api.test/override', method: 'put', headers: { Authorization: 'Bearer tok' } } }),
      makeCtx(node())
    )
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { url: string; method: string; headers: KV[] }
    expect(flushed.url).toBe('https://api.test/override')
    expect(flushed.method).toBe('PUT')
    // bound {{token}} header kept + Authorization added
    expect(flushed.headers.find((kv) => kv.key === 'X-Env')?.value).toBe('{{token}}')
    expect(flushed.headers.find((kv) => kv.key === 'Authorization')?.value).toBe('Bearer tok')
  })

  it('short-circuits to a synthetic skipped response when the override carries __skipRequest (pm.execution.skipRequest)', async () => {
    const result = await httpRequestExecutor(
      makeActivation({ requestOverride: { url: 'https://api.test/x', method: 'GET', headers: {}, __skipRequest: true } }),
      makeCtx(node())
    )
    const out = result.outputs.find((o) => o.port === 'response')?.value as {
      response: { status: number; statusText: string; success: boolean; skipped: boolean }
    }
    expect(out.response.skipped).toBe(true)
    expect(out.response.success).toBe(true)
    expect(out.response.statusText).toBe('skipped')
    // the network was NOT hit
    expect(execute).not.toHaveBeenCalled()
    expect(flushRequestStateToContext).not.toHaveBeenCalled()
  })
})

describe('httpRequestExecutor — OData verb + body composition', () => {
  /** A persisted OData ACTION request: no `method` field (the verb is derived
   * from operationKind), an actionBody JSON payload. */
  function makeODataAction(): Record<string, unknown> {
    return {
      id: 'req-1',
      type: 'odata',
      url: 'http://localhost:8078/odata/Pets(1)/Restorm.AdoptPet',
      operationKind: 'action',
      actionBody: '{"ownerId":7}',
      headers: [] as KV[],
      params: [] as KV[],
      pathParams: []
    }
  }

  it('an OData action feeds POST + the actionBody rawBody into HTTPExecutionInput', async () => {
    findById.mockReturnValue(makeODataAction())

    await httpRequestExecutor(makeActivation({}), makeCtx(node()))

    expect(execute).toHaveBeenCalledTimes(1)
    const input = execute.mock.calls[0]?.[0] as { method: string; rawBody?: string; rawBodyContentType?: string }
    // The verb + body come from composeODataRequestBody — the SAME composer the
    // request-panel Send uses — so the scenario path dispatches a real action
    // POST with the JSON payload, not a bodyless GET.
    expect(input.method).toBe('POST')
    expect(input.rawBody).toBe('{"ownerId":7}')
  })

  it('an OData entity-set read stays a bodyless GET (working path unregressed)', async () => {
    findById.mockReturnValue({
      id: 'req-1', type: 'odata', url: 'http://localhost:8078/odata/Pets',
      operationKind: 'entity-set', headers: [] as KV[], params: [] as KV[], pathParams: []
    })

    await httpRequestExecutor(makeActivation({}), makeCtx(node()))

    const input = execute.mock.calls[0]?.[0] as { method: string; rawBody?: string }
    expect(input.method).toBe('GET')
    expect(input.rawBody).toBeUndefined()
  })

  it('an OData batch with no sub-requests throws the composition error (never dispatches an empty POST)', async () => {
    findById.mockReturnValue({
      id: 'req-1', type: 'odata', url: 'http://localhost:8078/odata/$batch',
      operationKind: 'batch', batchSubRequests: [], headers: [] as KV[], params: [] as KV[], pathParams: []
    })

    await expect(httpRequestExecutor(makeActivation({}), makeCtx(node()))).rejects.toThrow(/no sub-requests/i)
    // The network was never hit — the guard fires before dispatch.
    expect(execute).not.toHaveBeenCalled()
  })

  it('records OData execution history under the `odata` kind, not `http`', async () => {
    findById.mockReturnValue(makeODataAction())

    await httpRequestExecutor(makeActivation({}), makeCtx(node()))

    expect(storeExecutionResult).toHaveBeenCalledTimes(1)
    expect(storeExecutionResult.mock.calls[0]?.[1]).toBe('odata')
  })
})

describe('applyRequestOverride (pm.request / req mutation → bound request)', () => {
  const baseReq = (): Record<string, unknown> => ({
    id: 'r', type: 'http', url: 'https://api.test/pets', method: 'GET',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }] as KV[], params: [], pathParams: []
  })

  it('returns the request unchanged when there is no override', () => {
    const r = baseReq() as never
    expect(applyRequestOverride(r, undefined)).toBe(r)
    expect(applyRequestOverride(r, null)).toBe(r)
  })

  it('replaces url/method (upper-cased) and MERGES headers, ignoring empty fields', () => {
    const out = applyRequestOverride(baseReq() as never, { url: 'https://api.test/pets?limit=5', method: 'post', headers: { Authorization: 'Bearer xyz' } }) as unknown as { url: string; method: string; headers: KV[] }
    expect(out.url).toBe('https://api.test/pets?limit=5')
    expect(out.method).toBe('POST')
    expect(out.headers.find((h) => h.key === 'Accept')?.value).toBe('application/json')
    expect(out.headers.find((h) => h.key === 'Authorization')?.value).toBe('Bearer xyz')
    const kept = applyRequestOverride(baseReq() as never, { url: '', method: '' }) as unknown as { url: string; method: string }
    expect(kept.url).toBe('https://api.test/pets')
    expect(kept.method).toBe('GET')
  })

  it('sets the body as a text body (stringifying a non-string) and does not mutate the original', () => {
    const r = baseReq()
    const out = applyRequestOverride(r as never, { body: { a: 1 }, headers: { X: '1' } }) as unknown as { body: unknown }
    // Wrapped into the tagged text-body shape — a bare string would have no
    // `type` and the executor would reject it ("Unknown body type").
    expect(out.body).toEqual({ type: 'text', content: '{"a":1}' })
    expect((r.headers as KV[]).some((h) => h.key === 'X')).toBe(false)
  })

  it('wraps a string body override into a text body', () => {
    const out = applyRequestOverride(baseReq() as never, { body: '{{petPayload}}' }) as unknown as { body: unknown }
    expect(out.body).toEqual({ type: 'text', content: '{{petPayload}}' })
  })
})

describe('httpRequestExecutor — on-box override ports', () => {
  it('overrides url + method via inline config.overrides', async () => {
    const n = { id: 'n1', kind: 'httpRequest', config: { requestId: 'req-1', overrides: { url: 'https://inline.test/x', method: 'put' } }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    await httpRequestExecutor(makeActivation({}), makeCtx(n))
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { url: string; method: string }
    expect(flushed.url).toBe('https://inline.test/x')
    expect(flushed.method).toBe('PUT') // upper-cased
  })

  it('a wired slot wins over the inline override (live > stored)', async () => {
    const n = { id: 'n1', kind: 'httpRequest', config: { requestId: 'req-1', overrides: { url: 'https://inline.test', 'headers:X-Test': 'inline' } }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    await httpRequestExecutor(makeActivation({ url: 'https://wired.test', 'headers:X-Test': 'wired' }), makeCtx(n))
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { url: string; headers: KV[] }
    expect(flushed.url).toBe('https://wired.test')
    expect(flushed.headers.find((kv) => kv.key === 'X-Test')?.value).toBe('wired')
  })

  it('resolves a picked project quick-config by id, then layers the inline override on top', async () => {
    findById.mockReturnValue({
      ...makeRequest(),
      url: 'https://base.test',
      quickConfigs: [{ id: 'qc-1', name: 'Prod', requestId: 'req-1', storageTarget: 'project', fields: { url: 'https://config.test', method: 'GET' } }]
    })
    const n = { id: 'n1', kind: 'httpRequest', config: { requestId: 'req-1', quickConfigId: 'qc-1', overrides: { method: 'DELETE' } }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    await httpRequestExecutor(makeActivation({}), makeCtx(n))
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { url: string; method: string }
    expect(flushed.url).toBe('https://config.test') // from the config
    expect(flushed.method).toBe('DELETE') // inline override wins over the config's GET
  })

  it('a deleted config id falls back to overrides-only (no throw)', async () => {
    const n = { id: 'n1', kind: 'httpRequest', config: { requestId: 'req-1', quickConfigId: 'qc-gone', overrides: { url: 'https://only.test' } }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    await httpRequestExecutor(makeActivation({}), makeCtx(n))
    const flushed = flushRequestStateToContext.mock.calls[0]?.[0] as { url: string }
    expect(flushed.url).toBe('https://only.test')
  })
})
