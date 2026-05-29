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
import { responseHistoryService } from '../../services/ResponseHistoryService'
import { flushRequestStateToContext } from '../../mcp/tools/execute'
import { isHTTPRequest, isAuthenticationRequest } from '../../../shared/types/collections'
import type { Request } from '../../../shared/types/collections'
import type { NodeExecutor } from '../types'

export const httpRequestExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { requestId?: string }
  if (typeof cfg.requestId !== 'string') throw new Error(`httpRequest node ${ctx.node.id} has no bound requestId`)
  const req = collectionStore.findById(cfg.requestId)
  if (!req) throw new Error(`bound request ${cfg.requestId} not found`)
  if (!isHTTPRequest(req)) throw new Error(`bound request ${cfg.requestId} is not HTTP (${(req as { type?: string }).type})`)

  // Slot short-circuit: a wired input port whose id is `pathParams:<key>`
  // / `headers:<key>` / `params:<key>` / `body` overrides that slot's
  // value. We apply the overrides onto a shallow CLONE of the request,
  // then flush THAT clone into the ContextService so the executor's
  // env + Handlebars resolution (incl. `{{name}}` path-param lookup)
  // sees the wired value — exactly the "résolution classique
  // court-circuitée slot par slot" the spec asks for.
  const effectiveReq = applySlotOverrides(req, act.inputs)
  flushRequestStateToContext(effectiveReq)

  const authId = req.authenticationRequestId
  const auth = authId ? collectionStore.findById(authId) : null
  const input: HTTPExecutionInput = {
    requestId: req.id,
    method: req.method,
    ...(auth && isAuthenticationRequest(auth) ? { authRequest: auth } : {})
  }

  // Cancellation: HTTPExecutionService.cancel(req.id) is the existing
  // hook; we wire the AbortSignal to call it.
  const onAbort = (): void => { httpExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })

  const result = await httpExecutionService.execute(input)
  ctx.signal.removeEventListener('abort', onAbort)
  await responseHistoryService.storeExecutionResult(req.id, 'http', result)

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
            method: req.method,
            headers: result.requestHeaders ?? {}
          },
          response: {
            status: result.statusCode ?? 0,
            statusText: result.statusText ?? '',
            headers: result.headers ?? {},
            body: result.body,
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
  const http = req as unknown as { pathParams?: KV[]; headers?: KV[]; params?: KV[]; body?: unknown }
  const clone = Object.assign(Object.create(Object.getPrototypeOf(req) as object), req, {
    pathParams: cloneKVs(http.pathParams),
    headers: cloneKVs(http.headers),
    params: cloneKVs(http.params)
  }) as unknown as { pathParams: KV[]; headers: KV[]; params: KV[]; body?: unknown }
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
  return clone as unknown as Request
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
