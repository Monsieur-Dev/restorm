/**
 * Redis scenario executors — the dual-mode split mirrored from
 * `RedisExecutionService` itself:
 *
 * - `redisSubscribe` (A) returns an `openSocketioConnect` scope action with
 *   `transport: 'redis-subscribe'`; the scheduler owns the long-lived
 *   connection lifecycle exactly as it does for `mqttConnect`. The executor's
 *   only job is to resolve the bound (subscribe-mode) request.
 * - `redisClose` (B) closes an already-declared subscribe connection via the
 *   `ctx.socketio` bridge the scheduler provides — same as `mqttClose`.
 * - `redisCommand` (C) is unary — one command on a fresh client, then
 *   disconnect — so it binds like `soapRequest` (a single `config.requestId`,
 *   a single `response` output), NOT the connect/close pair above.
 *
 * `redisClose` references the connect node by id (`config.connectionNodeId`).
 * With no connection selected — or the connection not open — it throws,
 * routing to the node's `error` port (or failing the run): a hard error, as
 * specified, rather than a silent no-op.
 */

import type { NodeExecutor } from '../types'
import { collectionStore } from '../../services/CollectionStore'
import { redisExecutionService } from '../../services/RedisExecutionService'
import { flushRequestStateToContext } from '../../mcp/tools/execute'
import { isRedisRequest } from '../../../shared/types/collections'
import { QUICK_CONFIG_ID_KEY, OVERRIDES_KEY } from '../../../shared/scenarioActionOverride'

/** Pull the node's override config (picked quick-config id + static field
 * overrides) into a scope-action `overrideConfig`, or undefined when none is
 * set — mirrors `socketioExecutors.ts`'s `overrideConfigFrom`. */
function overrideConfigFrom(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const key of [QUICK_CONFIG_ID_KEY, OVERRIDES_KEY]) {
    if (config[key] !== undefined) out[key] = config[key]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A (redisSubscribe): hand the subscribe connection off to the scheduler. */
export const redisSubscribeExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`redisSubscribe node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: {
      type: 'openSocketioConnect',
      transport: 'redis-subscribe',
      requestId: cfg.requestId,
      // Redis pub/sub has no named events beyond the channel itself — every
      // message routes to the single `message` port (mirrors mqttConnect).
      events: [],
      connectionName,
      ...(overrideConfigFrom(ctx.node.config) ? { overrideConfig: overrideConfigFrom(ctx.node.config) } : {})
    }
  }
}

/** B (redisClose): close the referenced subscribe connection (same as mqttClose). */
export const redisCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('redisClose: no connection selected')
  if (!ctx.socketio) throw new Error('redisClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('redisClose: the referenced connection does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/** C (redisCommand): unary — one command on a fresh client, then disconnect.
 * `RedisExecutionService.runCommand` persists the result to history itself
 * (mirrors `grpcExecutionService.execute` / `soapExecutionService.execute`),
 * so no double-persist here. */
export const redisCommandExecutor: NodeExecutor = async (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: string }
  if (typeof cfg.requestId !== 'string') throw new Error(`redisCommand node ${ctx.node.id} has no bound requestId`)
  const req = collectionStore.findById(cfg.requestId)
  if (!req) throw new Error(`bound request ${cfg.requestId} not found`)
  if (!isRedisRequest(req)) throw new Error(`bound request ${cfg.requestId} is not Redis (${(req as { type?: string }).type})`)

  // Same "authoritative whether or not the tab is open" fix as httpRequest /
  // soapRequest — the execution service reads the resolved URL/password/
  // command/args from the ContextService, not the renderer's local state.
  flushRequestStateToContext(req)

  const onAbort = (): void => { redisExecutionService.cancel(req.id) }
  if (ctx.signal.aborted) onAbort()
  else ctx.signal.addEventListener('abort', onAbort, { once: true })

  const result = await redisExecutionService.runCommand({ requestId: req.id })
  ctx.signal.removeEventListener('abort', onAbort)

  // Redis has no HTTP-style status code — `success` carries the outcome, like
  // the SOAP fault convention (a fault/error routes through the response
  // object, not the transport `error`, so a downstream if/assert can branch on it).
  return {
    outputs: [
      {
        port: 'response',
        value: {
          request: {
            url: result.requestUrl ?? '',
            method: result.command ?? '',
            headers: {}
          },
          response: {
            status: 0,
            statusText: '',
            headers: {},
            body: result.reply ?? '',
            durationMs: result.timings.durationMs,
            success: result.success,
            ...(result.error !== undefined ? { error: result.error } : {})
          }
        }
      }
    ]
  }
}
