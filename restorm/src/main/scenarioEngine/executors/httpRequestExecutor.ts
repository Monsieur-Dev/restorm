/**
 * Executor for `httpRequest` / `request` boxes. Reuses the existing
 * `httpExecutionService` so the engine sends real HTTP through the
 * same pipeline as the classic Send button — including auth, env-
 * resolved URLs, Handlebars, and the firewall.
 *
 * **Slot short-circuit (key acceptance criterion)**: when an input
 * port whose name maps to a request slot (URL / header / param /
 * pathParam / body) carries a value from a wired edge, the engine
 * overrides the request's persisted value for that slot before
 * dispatch. Resolved env vars + Handlebars still apply to slots that
 * are NOT short-circuited.
 *
 * Reuses the existing `flushRequestStateToContext` pre-dispatch hook
 * so the executor sees the latest env state even when the request's
 * tab isn't open in the renderer.
 */

import { collectionStore } from '../../services/CollectionStore'
import { httpExecutionService, type HTTPExecutionInput } from '../../services/HTTPExecutionService'
import { grpcExecutionService } from '../../services/GRPCExecutionService'
import { responseHistoryService } from '../../services/ResponseHistoryService'
import { flushRequestStateToContext } from '../../mcp/tools/execute'
import { isHTTPRequest, isAuthenticationRequest, isGrpcRequest, isODataRequest } from '../../../shared/types/collections'
import { composeODataRequestBody, type ODataBodySource } from '../../../shared/utils/odataRequestBody'
import type { Request } from '../../../shared/types/collections'
import type { NodeExecutor, ExecResult } from '../types'

export const httpRequestExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { requestId?: string }
  if (typeof cfg.requestId !== 'string') throw new Error(`httpRequest node ${ctx.node.id} has no bound requestId`)
  const req = collectionStore.findById(cfg.requestId)
  if (!req) throw new Error(`bound request ${cfg.requestId} not found`)
  // A one-shot gRPC request (a unary call binds to this generic request node,
  // like httpRequest; streaming gRPC binds a grpcConnect instead) runs through
  // the gRPC execution service and emits the same `{ request, response }` shape.
  if (isGrpcRequest(req)) return runGrpcUnary(req, ctx)
  // An OData request binds to this generic request node like HTTP: it executes
  // through the SAME httpExecutionService (the `odata:execute` IPC path does too),
  // and URLResolver composes its system query options into the resolved URL from
  // the odata fields flushRequestStateToContext carries. The model has no
  // `method`; the verb + body come from `composeODataRequestBody` — the SAME
  // composer the request-panel Send uses — so the scenario path and the panel
  // produce byte-identical wire bodies: entity-set / function reads = GET (no
  // body); action = POST with the `actionBody` JSON; batch = POST with the
  // assembled multipart/mixed (or JSON) `$batch` envelope. The composition runs
  // against `effectiveReq` below (after slot/request overrides) so a wired
  // override is honoured.
  const odata = isODataRequest(req)
  if (!isHTTPRequest(req) && !odata) throw new Error(`bound request ${cfg.requestId} is not HTTP or OData (${(req as { type?: string }).type})`)
  // Verb for the synthetic skip response (before slot overrides apply); the real
  // dispatch re-composes verb + body from `effectiveReq` below.
  const method = odata
    ? composeODataRequestBody(req as unknown as ODataBodySource).method
    : (req as { method: string }).method

  // Slot short-circuit: a wired input port whose id is `pathParams:<key>`
  // / `headers:<key>` / `params:<key>` / `body` overrides that slot's
  // value. We apply the overrides onto a shallow CLONE of the request,
  // then flush THAT clone into the ContextService so the executor's
  // env + Handlebars resolution (incl. `{{name}}` path-param lookup)
  // sees the wired value — exactly the "résolution classique
  // court-circuitée slot par slot" the spec asks for.
  // A whole-request override (from an upstream pre-request `code` node that
  // mutated `pm.request` / `req`) is merged first, then per-slot wired inputs
  // win on top.
  // A pre-request script that called `pm.execution.skipRequest()` flags the
  // request override with `__skipRequest`; honour it by emitting a synthetic
  // "skipped" response and NOT hitting the network, so downstream nodes still
  // get a (skipped, successful) response to flow from.
  const override = act.inputs['requestOverride']
  if (override && typeof override === 'object' && (override as { __skipRequest?: unknown }).__skipRequest === true) {
    return {
      outputs: [
        {
          port: 'response',
          value: {
            request: { url: req.url, method, headers: {} },
            response: { status: 0, statusText: 'skipped', headers: {}, body: '', durationMs: 0, success: true, skipped: true }
          }
        }
      ]
    }
  }

  const effectiveReq = applySlotOverrides(applyRequestOverride(req, override), act.inputs)
  flushRequestStateToContext(effectiveReq)

  // For OData, derive the dispatched verb + body from the (override-applied)
  // request via the shared composer — byte-identical to the request-panel Send.
  // An empty batch throws here (the panel surfaces the same message inline).
  const composed = odata ? composeODataRequestBody(effectiveReq as unknown as ODataBodySource) : undefined
  if (composed?.error !== undefined) throw new Error(composed.error)
  const dispatchMethod = composed ? composed.method : method

  const authId = req.authenticationRequestId
  const auth = authId ? collectionStore.findById(authId) : null
  const input: HTTPExecutionInput = {
    requestId: req.id,
    method: dispatchMethod,
    ...(composed?.rawBody !== undefined
      ? { rawBody: composed.rawBody, ...(composed.rawBodyContentType !== undefined ? { rawBodyContentType: composed.rawBodyContentType } : {}) }
      : {}),
    ...(auth && isAuthenticationRequest(auth) ? { authRequest: auth } : {})
  }

  // Cancellation: HTTPExecutionService.cancel(req.id) is the existing
  // hook; we wire the AbortSignal to call it.
  const onAbort = (): void => { httpExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })

  const result = await httpExecutionService.execute(input)
  ctx.signal.removeEventListener('abort', onAbort)
  await responseHistoryService.storeExecutionResult(req.id, odata ? 'odata' : 'http', result)

  // The `response` port carries the SAME `{ request, response }` shape the
  // JSON-path picker shows (see `getScenarioNodeResult` in
  // `mcp/tools/scenarioRun.ts`). Keeping the runtime token and the picker
  // context identical is what makes a picker-built selector like
  // `response.body.data.cooldown.total_seconds` resolve at run time.
  //
  // `result.body` is the raw response string; `resolveSelectorPath` parses
  // it lazily when a selector drills past `response.body`.
  return {
    outputs: [
      {
        port: 'response',
        value: {
          request: {
            url: result.requestUrl,
            method: dispatchMethod,
            headers: result.requestHeaders ?? {}
          },
          response: {
            status: result.statusCode ?? 0,
            statusText: result.statusText ?? '',
            headers: result.headers ?? {},
            body: result.body,
            durationMs: result.timings.durationMs,
            // `success` reflects the HTTP status class (2xx), like the web
            // `Response.ok`, NOT mere transport completion — so an `if`/`assert`
            // wired to `response.success` treats a 4xx/5xx as a failure. A
            // transport error yields no/0 status, hence `success: false` too.
            // (The classic Send button keeps its own transport-level `success`.)
            success: (result.statusCode ?? 0) >= 200 && (result.statusCode ?? 0) < 300,
            ...(result.error !== undefined ? { error: result.error } : {})
          }
        }
      }
    ]
  }
}

/** Run a bound gRPC request (a unary one-shot in scenario terms) and shape its
 * result onto the `response` port like an HTTP request node. */
async function runGrpcUnary(req: Request, ctx: Parameters<NodeExecutor>[1]): Promise<ExecResult> {
  flushRequestStateToContext(req)
  const onAbort = (): void => { grpcExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })
  const result = await grpcExecutionService.execute({ requestId: req.id })
  ctx.signal.removeEventListener('abort', onAbort)
  // `execute()` persists the call to history itself.
  return {
    outputs: [
      {
        port: 'response',
        value: {
          request: { url: result.requestUrl ?? '', method: result.requestMethod ?? '', headers: {} },
          response: {
            status: result.statusCode ?? 0,
            statusText: result.statusMessage ?? '',
            headers: {},
            body: result.responseMessage ?? '',
            durationMs: result.timings.durationMs,
            success: result.success,
            ...(result.error !== undefined ? { error: result.error } : {})
          }
        }
      }
    ]
  }
}

interface KV { key: string; value?: unknown; enabled?: boolean }

/** The HTTP fields the override paths read/write on a `Request`. */
interface HttpRequestShape {
  url?: string
  method?: string
  pathParams?: KV[]
  headers?: KV[]
  params?: KV[]
  body?: unknown
}

/**
 * Prototype-preserving shallow clone of a `Request`, with the supplied
 * key→value-array fields deep-copied so a mutation of the clone never touches
 * the persisted request. Centralises the `Object.create(getPrototypeOf) +
 * Object.assign` dance (and its casts) the override paths used to repeat.
 */
function cloneHttpRequest(req: Request, kvOverrides: Partial<Pick<HttpRequestShape, 'pathParams' | 'headers' | 'params'>>): Request & HttpRequestShape {
  const src = req as Request & HttpRequestShape
  const clone = Object.assign(Object.create(Object.getPrototypeOf(req) as object) as object, src)
  for (const [field, value] of Object.entries(kvOverrides)) {
    (clone as Record<string, unknown>)[field] = cloneKVs(value as KV[] | undefined)
  }
  return clone as Request & HttpRequestShape
}

/**
 * Return the request to flush + execute, with any wired slot inputs
 * applied. Input port ids mirror the editor + MCP slot ports:
 * `pathParams:<key>`, `headers:<key>`, `params:<key>`, `body`. When
 * nothing is wired, the original request is returned unchanged. The
 * clone is shallow per-array so the persisted request is never
 * mutated.
 */
function applySlotOverrides(req: Request, inputs: Record<string, unknown>): Request {
  const slotKeys = Object.keys(inputs).filter((k) => isSlotPort(k) && inputs[k] !== undefined)
  if (slotKeys.length === 0) return req
  const http = req as Request & HttpRequestShape
  const clone = cloneHttpRequest(req, {
    pathParams: http.pathParams ?? [],
    headers: http.headers ?? [],
    params: http.params ?? []
  })
  for (const portId of slotKeys) {
    const value = inputs[portId]
    if (portId === 'body') { clone.body = value; continue }
    const sep = portId.indexOf(':')
    const group = portId.slice(0, sep)
    const key = portId.slice(sep + 1)
    const arr = group === 'pathParams' ? clone.pathParams : group === 'headers' ? clone.headers : group === 'params' ? clone.params : null
    if (!arr) continue
    const existing = arr.find((kv) => kv.key === key)
    if (existing) existing.value = stringifyToWire(value)
    else arr.push({ key, value: stringifyToWire(value), enabled: true })
  }
  return clone
}

/**
 * Merge a whole-request override `{ url?, method?, headers?, body? }` over the
 * bound request (from a pre-request script that mutated `pm.request` / `req`).
 * Empty/absent fields are ignored so an un-mutated field keeps the bound value;
 * `headers` is a key→value MAP that's merged into (not replacing) the request's
 * headers. Returns the request unchanged when there's no override.
 */
export function applyRequestOverride(req: Request, override: unknown): Request {
  if (!override || typeof override !== 'object') return req
  const o = override as { url?: unknown; method?: unknown; headers?: unknown; body?: unknown }
  const http = req as Request & HttpRequestShape
  const clone = cloneHttpRequest(req, { headers: http.headers ?? [] })
  const headers = clone.headers ?? []
  if (typeof o.url === 'string' && o.url !== '') clone.url = o.url
  if (typeof o.method === 'string' && o.method !== '') clone.method = o.method.toUpperCase()
  if (o.headers && typeof o.headers === 'object' && !Array.isArray(o.headers)) {
    for (const [key, value] of Object.entries(o.headers as Record<string, unknown>)) {
      const existing = headers.find((kv) => kv.key === key)
      if (existing) { existing.value = stringifyToWire(value); existing.enabled = true }
      else headers.push({ key, value: stringifyToWire(value), enabled: true })
    }
  }
  // A pm/bru pre-request script exposes `pm.request.body` / `req.getBody()` as a
  // raw string, so an override body arrives as a string (or a JSON-able object).
  // The HTTP body model is a tagged union — a bare string has no `type`, which
  // the executor rejects ("Unknown body type: undefined"). Wrap it as a text
  // body (how restorm sends raw / JSON payloads).
  if (o.body !== undefined) {
    clone.body = { type: 'text', content: typeof o.body === 'string' ? o.body : stringifyToWire(o.body) }
  }
  return clone
}

function isSlotPort(portId: string): boolean {
  return portId === 'body' || portId.startsWith('pathParams:') || portId.startsWith('headers:') || portId.startsWith('params:')
}

function cloneKVs(kvs: KV[] | undefined): KV[] {
  return (kvs ?? []).map((kv) => ({ ...kv }))
}

function stringifyToWire(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}
