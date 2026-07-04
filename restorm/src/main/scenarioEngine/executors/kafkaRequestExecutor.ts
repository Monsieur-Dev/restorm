/**
 * Executor for `kafkaProduce` boxes. Reuses the existing
 * `KafkaExecutionService.produce()` so the engine sends through the
 * same one-shot connect->send->disconnect pipeline as the request
 * panel's Produce button.
 *
 * Unlike every other protocol, Kafka's `KafkaExecutionService` already
 * persists the result to `ResponseHistoryService` itself (see
 * `produce()` — it self-persists like the streaming connects do,
 * rather than the caller persisting as `httpRequestExecutor` /
 * `soapRequestExecutor` do), so this executor does NOT call
 * `storeExecutionResult` again.
 *
 * Kafka has no per-request slot-override machinery (no headers/params/
 * pathParams) and no per-run mode branch: `kafkaProduce` always calls
 * `produce()` regardless of the bound request's own `mode` field —
 * `mode` only drives which pane the request-panel tab shows for an
 * interactive Run (see `KafkaRequest.mode`'s own doc comment).
 */

import { collectionStore } from '../../services/CollectionStore'
import { kafkaExecutionService } from '../../services/KafkaExecutionService'
import { flushRequestStateToContext } from '../../mcp/tools/execute'
import { isKafkaRequest } from '../../../shared/types/collections'
import type { NodeExecutor } from '../types'

export const kafkaProduceExecutor: NodeExecutor = async (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: string }
  if (typeof cfg.requestId !== 'string') throw new Error(`kafkaProduce node ${ctx.node.id} has no bound requestId`)
  const req = collectionStore.findById(cfg.requestId)
  if (!req) throw new Error(`bound request ${cfg.requestId} not found`)
  if (!isKafkaRequest(req)) throw new Error(`bound request ${cfg.requestId} is not Kafka (${(req as { type?: string }).type})`)

  // Make the executor authoritative whether or not the request's tab is open in
  // the renderer (same fix httpRequestExecutor / soapRequestExecutor use): the
  // Kafka service reads the resolved brokers/topic/key/value/headers/auth from
  // the ContextService.
  flushRequestStateToContext(req)

  // Cancellation: kafkaExecutionService.cancel(req.id) aborts the live produce;
  // wire the run's AbortSignal to it so a Stop cleans up.
  const onAbort = (): void => { kafkaExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })

  const result = await kafkaExecutionService.produce({ requestId: req.id })
  ctx.signal.removeEventListener('abort', onAbort)

  // The `response` port carries the SAME `{ request, response }` shape every
  // other one-shot request node emits, so a picker-built selector
  // (`response.body.partition`) resolves identically at run time — `body` is a
  // JSON string of the produced RecordMetadata (topic/partition/offset), the
  // closest Kafka analog to an HTTP response body.
  return {
    outputs: [
      {
        port: 'response',
        value: {
          request: { url: result.requestUrl, method: 'PRODUCE', headers: {} },
          response: {
            status: result.success ? 200 : 0,
            statusText: '',
            headers: {},
            body: JSON.stringify({ topic: result.requestTopic, partition: result.partition, offset: result.offset }),
            durationMs: result.timings.durationMs,
            success: result.success,
            ...(result.error !== undefined ? { error: result.error } : {})
          }
        }
      }
    ]
  }
}
