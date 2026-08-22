/**
 * JSON-RPC 2.0 execution service — a thin request-shaping layer over
 * `HTTPExecutionService` (JSON-RPC is HTTP POST + a JSON envelope under the
 * hood). Composes `{ jsonrpc: '2.0', method, params, id }`, dispatches via
 * `httpExecutionService.execute` with a pre-built `rawBody`, then unwraps
 * `result` / `error` from the response body. Batch calls compose an array
 * of such envelopes in one POST and match each response entry back to its
 * originating child by `id`.
 */

import { randomUUID } from 'crypto'
import { httpExecutionService, type HTTPExecutionResult } from './HTTPExecutionService'
import { contextService } from './ContextService'
import type { ResolutionContexts } from './ContextServiceTypes'
import type { CookiePair } from '../../shared/cookies/cookieTypes'

/** One resolved JSON-RPC error object, per spec section 5.1. */
export interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcExecutionInput {
  requestId: string
  timeout?: number
  /** The DISPOSABLE contexts this one dispatch resolves against — see
   * `HTTPExecutionInput.runContexts`. Absent outside a scenario run. */
  runContexts?: ResolutionContexts
}

export interface JsonRpcExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  /** Present when the call was a notification (no `id` sent, no envelope
   * expected back) — the response panel shows "Notification sent" instead
   * of a result/error. */
  notificationSent?: boolean
  /** Successful JSON-RPC `result` payload. */
  result?: unknown
  /** JSON-RPC `error` payload, per spec section 5.1. */
  error?: JsonRpcErrorShape
  /** Transport-level error (network failure, invalid params JSON, …) —
   * distinct from a JSON-RPC `error` response, which is a SUCCESSFUL HTTP
   * call whose envelope reports an application-level failure. */
  transportError?: string
  rawBody?: string
  timings: { startedAt: string; durationMs: number }
  requestUrl?: string
  requestHeaders?: Record<string, string>
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
}

export interface JsonRpcBatchChildResult {
  childId: string
  rpcId: string
  result?: unknown
  error?: JsonRpcErrorShape
  /** True when no response entry matched this child's id (server dropped it,
   * or the batch response wasn't a well-formed array of envelopes). */
  unmatched?: boolean
}

export interface JsonRpcBatchExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  transportError?: string
  rawBody?: string
  children: JsonRpcBatchChildResult[]
  timings: { startedAt: string; durationMs: number }
  requestUrl?: string
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
}

/** One child call as read off the registered request's `fullData`. */
export interface JsonRpcBatchChildInput {
  childId: string
  method: string
  params: string
  rpcId: string
  notificationMode?: boolean
}

/** Resolve (Handlebars/env) `method` / `params` / `id`, parse `params`'
 * JSON text, and compose the wire envelope object for one call. Resolution
 * happens HERE (not inside `HTTPExecutionService`) because `params` must be
 * parsed into a real array/object before it can be embedded as a genuine
 * JSON value — resolving the raw text first keeps `{{var}}` substitution
 * working inside `params` even though it's parsed as structured JSON,
 * not passed through as an opaque string. */
function composeEnvelope(
  requestId: string,
  call: { method: string; params: string; rpcId: string; notificationMode?: boolean },
  runContexts?: ResolutionContexts
): { envelope: Record<string, unknown>; rpcId: string } | { parseError: string } {
  // Method, params and id belong to no row family — they resolve against the
  // execution's `base` context, like a text body.
  const method = contextService.resolveValue(call.method, requestId, runContexts?.base)
  const rawParams = call.params.trim()
  const resolvedParamsText = rawParams.length > 0 ? contextService.resolveValue(rawParams, requestId, runContexts?.base) : ''
  let parsedParams: unknown
  if (resolvedParamsText.length > 0) {
    try {
      parsedParams = JSON.parse(resolvedParamsText)
    } catch (err) {
      return { parseError: `Invalid params JSON for method "${method}": ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  const resolvedId = contextService.resolveValue(call.rpcId, requestId, runContexts?.base)
  const rpcId = resolvedId.length > 0 ? resolvedId : randomUUID()
  const notificationMode = call.notificationMode === true
  const envelope: Record<string, unknown> = { jsonrpc: '2.0', method }
  if (parsedParams !== undefined) envelope.params = parsedParams
  if (!notificationMode) envelope.id = rpcId
  return { envelope, rpcId }
}

/** Parse a JSON-RPC response body into its `result` / `error` fields.
 * Returns `undefined` when the body isn't valid JSON — the caller then
 * surfaces the raw body instead of a bogus unwrap. */
function parseEnvelopeResponse(body: string | undefined): { result?: unknown; error?: JsonRpcErrorShape; id?: unknown } | undefined {
  if (!body) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object') {
      return parsed as { result?: unknown; error?: JsonRpcErrorShape; id?: unknown }
    }
    return undefined
  } catch {
    return undefined
  }
}

class JsonRpcExecutionService {
  /** Execute a single JSON-RPC call, reading `method` / `params` / `id` /
   * `notificationMode` off the request's registered `fullData` (flushed by
   * the renderer tab view, or by `flushRequestStateToContext` for a
   * cold-start MCP dispatch). */
  async execute(input: JsonRpcExecutionInput): Promise<JsonRpcExecutionResult> {
    const { requestId, timeout, runContexts } = input
    const startedAt = new Date().toISOString()
    const data = contextService.getRequestContext(requestId)?.fullData
    if (!data) {
      return {
        requestId,
        success: false,
        transportError: 'No resolved request data found for this request. Make sure the request is registered.',
        timings: { startedAt, durationMs: 0 }
      }
    }
    const composed = composeEnvelope(requestId, {
      method: data.jsonRpcMethod ?? '',
      params: data.jsonRpcParams ?? '',
      rpcId: data.jsonRpcId ?? '',
      notificationMode: data.jsonRpcNotificationMode
    }, runContexts)
    if ('parseError' in composed) {
      return { requestId, success: false, transportError: composed.parseError, timings: { startedAt, durationMs: 0 } }
    }
    const notificationMode = data.jsonRpcNotificationMode === true
    const httpResult: HTTPExecutionResult = await httpExecutionService.execute({
      requestId,
      method: 'POST',
      ...(timeout !== undefined ? { timeout } : {}),
      rawBody: JSON.stringify(composed.envelope),
      rawBodyContentType: 'application/json',
      ...(runContexts !== undefined ? { runContexts } : {})
    })
    if (!httpResult.success) {
      return {
        requestId,
        success: false,
        transportError: httpResult.error,
        timings: httpResult.timings,
        ...(httpResult.requestUrl !== undefined ? { requestUrl: httpResult.requestUrl } : {})
      }
    }
    const base = {
      requestId,
      success: true,
      statusCode: httpResult.statusCode,
      ...(httpResult.statusText !== undefined ? { statusText: httpResult.statusText } : {}),
      timings: httpResult.timings,
      ...(httpResult.requestUrl !== undefined ? { requestUrl: httpResult.requestUrl } : {}),
      ...(httpResult.requestHeaders !== undefined ? { requestHeaders: httpResult.requestHeaders } : {}),
      ...(httpResult.body !== undefined ? { rawBody: httpResult.body } : {}),
      ...(httpResult.sentCookies ? { sentCookies: httpResult.sentCookies } : {}),
      ...(httpResult.receivedCookies ? { receivedCookies: httpResult.receivedCookies } : {})
    }
    if (notificationMode) {
      return { ...base, notificationSent: true }
    }
    const unwrapped = parseEnvelopeResponse(httpResult.body)
    return {
      ...base,
      ...(unwrapped?.result !== undefined ? { result: unwrapped.result } : {}),
      ...(unwrapped?.error !== undefined ? { error: unwrapped.error } : {})
    }
  }

  /** Execute a `jsonrpc-batch` request: compose every child into one JSON
   * array, POST it in a single call, and match each response entry back to
   * its originating child by the (resolved) JSON-RPC `id`. */
  async executeBatch(input: JsonRpcExecutionInput): Promise<JsonRpcBatchExecutionResult> {
    const { requestId, timeout, runContexts } = input
    const startedAt = new Date().toISOString()
    const data = contextService.getRequestContext(requestId)?.fullData
    const children = data?.jsonRpcChildren ?? []
    if (children.length === 0) {
      return { requestId, success: false, transportError: 'Batch has no child calls.', children: [], timings: { startedAt, durationMs: 0 } }
    }
    const composedChildren: { childId: string; rpcId: string; envelope?: Record<string, unknown>; parseError?: string }[] = children.map((child) => {
      const composed = composeEnvelope(requestId, child, runContexts)
      return 'parseError' in composed
        ? { childId: child.childId, rpcId: child.rpcId, parseError: composed.parseError }
        : { childId: child.childId, rpcId: composed.rpcId, envelope: composed.envelope }
    })
    const validEnvelopes = composedChildren.filter((c): c is { childId: string; rpcId: string; envelope: Record<string, unknown> } => c.envelope !== undefined)
    if (validEnvelopes.length === 0) {
      return {
        requestId,
        success: false,
        transportError: composedChildren[0]?.parseError ?? 'All batch children failed to compose.',
        children: [],
        timings: { startedAt, durationMs: 0 }
      }
    }
    const httpResult: HTTPExecutionResult = await httpExecutionService.execute({
      requestId,
      method: 'POST',
      ...(timeout !== undefined ? { timeout } : {}),
      rawBody: JSON.stringify(validEnvelopes.map((c) => c.envelope)),
      rawBodyContentType: 'application/json',
      ...(runContexts !== undefined ? { runContexts } : {})
    })
    if (!httpResult.success) {
      return {
        requestId,
        success: false,
        transportError: httpResult.error,
        children: [],
        timings: httpResult.timings,
        ...(httpResult.requestUrl !== undefined ? { requestUrl: httpResult.requestUrl } : {})
      }
    }
    let responseEntries: { id?: unknown; result?: unknown; error?: JsonRpcErrorShape }[] = []
    try {
      const parsed: unknown = httpResult.body ? JSON.parse(httpResult.body) : []
      if (Array.isArray(parsed)) responseEntries = parsed as typeof responseEntries
    } catch {
      // Leave `responseEntries` empty — every child surfaces as unmatched
      // and the caller can inspect `rawBody` for the malformed response.
    }
    const childResults: JsonRpcBatchChildResult[] = composedChildren.map((c) => {
      if (c.envelope === undefined) {
        return { childId: c.childId, rpcId: c.rpcId, error: { code: -32700, message: c.parseError ?? 'Failed to compose call.' } }
      }
      const match = responseEntries.find((entry) => String(entry.id) === c.rpcId)
      if (!match) return { childId: c.childId, rpcId: c.rpcId, unmatched: true }
      return {
        childId: c.childId,
        rpcId: c.rpcId,
        ...(match.result !== undefined ? { result: match.result } : {}),
        ...(match.error !== undefined ? { error: match.error } : {})
      }
    })
    return {
      requestId,
      success: true,
      statusCode: httpResult.statusCode,
      ...(httpResult.body !== undefined ? { rawBody: httpResult.body } : {}),
      children: childResults,
      timings: httpResult.timings,
      ...(httpResult.requestUrl !== undefined ? { requestUrl: httpResult.requestUrl } : {}),
      ...(httpResult.sentCookies ? { sentCookies: httpResult.sentCookies } : {}),
      ...(httpResult.receivedCookies ? { receivedCookies: httpResult.receivedCookies } : {})
    }
  }

  cancel(requestId: string): boolean {
    return httpExecutionService.cancel(requestId)
  }

  isActive(requestId: string): boolean {
    return httpExecutionService.isActive(requestId)
  }
}

export const jsonRpcExecutionService = new JsonRpcExecutionService()
