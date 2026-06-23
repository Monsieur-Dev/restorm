/**
 * Executor for `soapRequest` boxes. Reuses the existing
 * `soapExecutionService` so the engine sends real SOAP through the
 * same pipeline as the classic Send button — including the resolved
 * URL, headers and body built by the ContextService.
 *
 * SOAP is a unary protocol — one request, one response — so the box
 * binds like `httpRequest` (a single `config.requestId`, a single
 * `response` output), NOT the streaming connect/send/close triplet.
 *
 * Like `httpRequestExecutor`, it flushes the bound request into the
 * ContextService first so the executor is authoritative whether or
 * not the request's tab is open in the renderer, and persists the
 * result to history so the inspector preview, replay and goldens have
 * data to read.
 */

import { collectionStore } from '../../services/CollectionStore'
import { soapExecutionService } from '../../services/SOAPExecutionService'
import { responseHistoryService } from '../../services/ResponseHistoryService'
import { flushRequestStateToContext } from '../../mcp/tools/execute'
import { isSoapRequest } from '../../../shared/types/collections'
import type { NodeExecutor } from '../types'

export const soapRequestExecutor: NodeExecutor = async (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: string }
  if (typeof cfg.requestId !== 'string') throw new Error(`soapRequest node ${ctx.node.id} has no bound requestId`)
  const req = collectionStore.findById(cfg.requestId)
  if (!req) throw new Error(`bound request ${cfg.requestId} not found`)
  if (!isSoapRequest(req)) throw new Error(`bound request ${cfg.requestId} is not SOAP (${(req as { type?: string }).type})`)

  // Make the executor authoritative whether or not the request's tab is open in
  // the renderer (same fix httpRequestExecutor / the MCP run_request use): the
  // SOAP service reads the resolved URL + headers + body from the ContextService.
  flushRequestStateToContext(req)

  // Cancellation: soapExecutionService.cancel(req.id) aborts the live dispatch;
  // wire the run's AbortSignal to it so a Stop cleans up.
  const onAbort = (): void => { soapExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })

  const result = await soapExecutionService.execute({ requestId: req.id })
  ctx.signal.removeEventListener('abort', onAbort)
  await responseHistoryService.storeExecutionResult(req.id, 'soap', result)

  // The `response` port carries the SAME `{ request, response }` shape the
  // JSON-path picker shows (see `resolveSoapPreview` in `mcp/tools/scenarioRun.ts`),
  // so a picker-built selector resolves identically at run time. A SOAP fault is
  // surfaced on the response object (not the transport `error`) so a downstream
  // `if`/`assert` can branch on it.
  return {
    outputs: [
      {
        port: 'response',
        value: {
          request: {
            url: result.requestUrl ?? '',
            method: 'POST',
            headers: {}
          },
          response: {
            status: result.statusCode ?? 0,
            statusText: '',
            headers: result.headers ?? {},
            body: result.responseBody ?? '',
            durationMs: result.timings.durationMs,
            // `success` mirrors the SOAP service's own verdict (a 2xx with no
            // fault); a fault or transport failure both yield `success: false`.
            success: result.success,
            ...(result.fault !== undefined ? { fault: result.fault } : {}),
            ...(result.error !== undefined ? { error: result.error } : {})
          }
        }
      }
    ]
  }
}
