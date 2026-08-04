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
const composeResolutionContexts = vi.fn<(id: string, overlay?: Record<string, string>) => unknown>()
const graphqlExecute = vi.fn<(i: unknown) => Promise<unknown>>()

vi.mock('../../services/CollectionStore', () => ({ collectionStore: { findById: (id: string) => findById(id) } }))
vi.mock('../../services/HTTPExecutionService', () => ({
  httpExecutionService: { execute: (i: unknown) => execute(i), cancel: (id: string) => { cancel(id) } }
}))
vi.mock('../../services/GraphQLExecutionService', () => ({
  graphqlExecutionService: { execute: (i: unknown) => graphqlExecute(i), cancel: () => undefined }
}))
vi.mock('../../services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: (...a: unknown[]) => storeExecutionResult(...a) }
}))
vi.mock('../../mcp/tools/execute', () => ({
  flushRequestStateToContext: (r: unknown) => { flushRequestStateToContext(r) },
  // The real stringifier: the executor reads the run's live variable map at
  // dispatch time, so what it hands to the composition is what the test wants
  // to see.
  scenarioVarsToOverlay: (vars: ReadonlyMap<string, unknown> | undefined) => {
    if (!vars || vars.size === 0) return undefined
    const out: Record<string, string> = {}
    for (const [k, v] of vars) out[k] = String(v)
    return out
  }
}))
vi.mock('../../services/ContextService', () => ({
  contextService: {
    composeResolutionContexts: (id: string, overlay?: Record<string, string>) => composeResolutionContexts(id, overlay),
    // No registered context: these cases exercise the PERSISTED request, so the
    // live-row overlay must be a no-op. `overlayLiveKeyValues` has its own
    // tests for the case where a panel edit is registered.
    getRequestContext: () => undefined
  }
}))

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
  composeResolutionContexts.mockReset().mockReturnValue({ base: {}, pathParams: {}, queryParams: {}, headers: {} })
  graphqlExecute.mockReset()
})

describe('httpRequestExecutor — GraphQL unary', () => {
  function makeGraphqlRequest(): Record<string, unknown> {
    return { id: 'req-1', type: 'graphql', url: 'https://gql.test/graphql', operationType: 'query', query: 'query { ping }', variables: '{}' }
  }
  function gqlResult(): Record<string, unknown> {
    return { requestId: 'req-1', success: true, statusCode: 200, data: { ping: 'pong' }, headers: { 'content-type': 'application/json' }, requestUrl: 'https://gql.test/graphql', timings: { startedAt: '2026-01-01T00:00:00.000Z', durationMs: 7 } }
  }

  it('runs a bound GraphQL request and shapes the response port (+ persists history)', async () => {
    findById.mockReturnValue(makeGraphqlRequest())
    graphqlExecute.mockResolvedValue(gqlResult())
    const out = await httpRequestExecutor(makeActivation({}), makeCtx(node()))
    expect(graphqlExecute).toHaveBeenCalledTimes(1)
    // History is stored by the executor (the service does not persist it itself),
    // and it archives against the SAME disposable contexts the dispatch used —
    // otherwise the stored "what we sent" would be resolved from the request's
    // own values and contradict the URL that actually went out.
    expect(storeExecutionResult).toHaveBeenCalledWith('req-1', 'graphql', expect.anything(), expect.anything())
    expect(graphqlExecute.mock.calls[0]?.[0]).toMatchObject({ requestId: 'req-1', runContexts: expect.anything() as unknown })
    const value = out.outputs[0]?.value as { request: { method: string; url: string }; response: { status: number; success: boolean; body: string } }
    expect(value.request.method).toBe('POST')
    expect(value.request.url).toBe('https://gql.test/graphql')
    expect(value.response.status).toBe(200)
    expect(value.response.success).toBe(true)
    // The wire body carries the `{ data, errors }` envelope so `response.body.data.…` selectors resolve.
    expect(JSON.parse(value.response.body)).toEqual({ data: { ping: 'pong' } })
  })
})

describe('httpRequestExecutor — the run\'s values travel as a disposable context', () => {
  it('composes the contexts from the run variables AS THEY STAND at this dispatch', async () => {
    // Composed per REQUEST EXECUTION, not once per run: the executor reads the
    // run's live variable map at the moment it dispatches, so a variable the run
    // declared since the previous request is in and one declared after is not.
    const ctx = makeCtx(node())
    ctx.variables.set('petId', 3)

    await httpRequestExecutor(makeActivation({}), ctx)
    expect(composeResolutionContexts).toHaveBeenCalledTimes(1)
    expect(composeResolutionContexts).toHaveBeenLastCalledWith('req-1', { petId: '3' })

    // The run declares another variable between the two requests.
    ctx.variables.set('token', 'declared-mid-run')
    await httpRequestExecutor(makeActivation({}), ctx)
    expect(composeResolutionContexts).toHaveBeenLastCalledWith('req-1', { petId: '3', token: 'declared-mid-run' })
  })

  it('hands the composed contexts to the dispatch and to the history archive', async () => {
    const ctx = makeCtx(node())
    ctx.variables.set('petId', 3)
    const composed = { base: { petId: '3' }, pathParams: { petId: '3' }, queryParams: { petId: '3' }, headers: { petId: '3' } }
    composeResolutionContexts.mockReturnValue(composed)

    await httpRequestExecutor(makeActivation({}), ctx)

    expect(execute.mock.calls[0]?.[0]).toMatchObject({ runContexts: composed })
    expect(storeExecutionResult).toHaveBeenCalledWith('req-1', 'http', expect.anything(), composed)
  })

  it('composes with no overlay when the run declared nothing', async () => {
    await httpRequestExecutor(makeActivation({}), makeCtx(node()))
    expect(composeResolutionContexts).toHaveBeenLastCalledWith('req-1', undefined)
  })
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
