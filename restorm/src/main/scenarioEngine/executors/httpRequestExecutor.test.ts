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
