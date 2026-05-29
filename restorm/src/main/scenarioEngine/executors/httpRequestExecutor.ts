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
import type { NodeExecutor } from '../types'

export const httpRequestExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { requestId?: string }
  if (typeof cfg.requestId !== 'string') throw new Error(`httpRequest node ${ctx.node.id} has no bound requestId`)
  const req = collectionStore.findById(cfg.requestId)
  if (!req) throw new Error(`bound request ${cfg.requestId} not found`)
  if (!isHTTPRequest(req)) throw new Error(`bound request ${cfg.requestId} is not HTTP (${(req as { type?: string }).type})`)

  flushRequestStateToContext(req)

  // Slot short-circuit: each input port name maps to a request slot.
  // Map them onto an override structure the execution service knows
  // how to merge.
  const overrides = readSlotOverrides(act.inputs)

  const authId = req.authenticationRequestId
  const auth = authId ? collectionStore.findById(authId) : null
  const input: HTTPExecutionInput = {
    requestId: req.id,
    method: req.method,
    ...(auth && isAuthenticationRequest(auth) ? { authRequest: auth } : {}),
    ...(overrides ? { runtimeOverrides: overrides } : {})
  }

  // Cancellation: HTTPExecutionService.cancel(req.id) is the existing
  // hook; we wire the AbortSignal to call it.
  const onAbort = (): void => { httpExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })

  const result = await httpExecutionService.execute(input)
  ctx.signal.removeEventListener('abort', onAbort)
  await responseHistoryService.storeExecutionResult(req.id, 'http', result)

  return {
    outputs: [
      {
        port: 'response',
        value: {
          status: result.statusCode ?? 0,
          statusText: result.statusText ?? '',
          headers: (result.responseHeaders ?? {}) as Record<string, string>,
          body: result.responseBody as unknown,
          durationMs: result.timings.durationMs,
          success: result.success
        }
      }
    ]
  }
}

/**
 * Per-slot overrides extracted from the activation inputs. The
 * runtime override map is read by HTTPExecutionService — slots not
 * present here fall back to the request's persisted (env-resolved)
 * value.
 */
function readSlotOverrides(inputs: Record<string, unknown>): {
  url?: string
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string>
  pathParams?: Record<string, string>
} | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(inputs)) {
    if (v === undefined) continue
    if (k === 'url' && typeof v === 'string') out['url'] = v
    else if (k === 'body') out['body'] = v
    else if (k.startsWith('header.')) {
      const h = (out['headers'] as Record<string, string> | undefined) ?? {}
      h[k.slice('header.'.length)] = stringifyToWire(v)
      out['headers'] = h
    } else if (k.startsWith('param.')) {
      const p = (out['params'] as Record<string, string> | undefined) ?? {}
      p[k.slice('param.'.length)] = stringifyToWire(v)
      out['params'] = p
    } else if (k.startsWith('path.')) {
      const p = (out['pathParams'] as Record<string, string> | undefined) ?? {}
      p[k.slice('path.'.length)] = stringifyToWire(v)
      out['pathParams'] = p
    }
  }
  return Object.keys(out).length > 0 ? out as ReturnType<typeof readSlotOverrides> : undefined
}

function stringifyToWire(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}
