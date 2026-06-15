/**
 * Socket.IO scenario executors (A / B / C).
 *
 * - `socketioConnect` (A) returns an `openSocketioConnect` scope action; the
 *   scheduler owns the long-lived connection lifecycle (open → re-emit each
 *   received event on its port → close), exactly as it owns a `timer`. The
 *   executor's only job is to resolve the bound request + listened events.
 * - `socketioSend` (B) emits a message on an already-declared connection via the
 *   `ctx.socketio` bridge the scheduler provides.
 * - `socketioClose` (C) closes an already-declared connection via the same bridge.
 *
 * B and C reference the connect node by id (`config.connectionNodeId`). With no
 * connection selected — or the connection not open — they throw, routing to the
 * node's `error` port (or failing the run): a hard error, as specified, rather
 * than a silent no-op.
 */

import type { NodeExecutor } from '../types'
import { readSocketioEvents } from '../../../shared/scenarioNodePorts'
import { resolveOperand } from '../conditionEval'

/** Coerce a resolved operand to the wire string the connection's `send` expects
 * (a JSON string for objects, the raw text otherwise). */
function toWire(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  // Objects / arrays → JSON; an unserializable payload (a cycle) falls back to ''.
  try { return JSON.stringify(v) } catch { return '' }
}

/** A (socketioConnect): hand the connection off to the scheduler. */
export const socketioConnectExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`socketioConnect node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: {
      type: 'openSocketioConnect',
      transport: 'socketio',
      requestId: cfg.requestId,
      events: readSocketioEvents(ctx.node.config),
      connectionName
    }
  }
}

/** A (websocketConnect): raw WebSocket — same handoff as socketioConnect, but no
 * events (every received frame routes to the single `message` port). */
export const websocketConnectExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`websocketConnect node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'websocket', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** B (websocketSend): send a raw payload (no channel) on the referenced connection. */
export const websocketSendExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown; payload?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('websocketSend: no connection selected')
  if (!ctx.socketio) throw new Error('websocketSend: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('websocketSend: the referenced connection does not exist in this run')
  }
  const payload = toWire(resolveOperand(act.inputs['payload'], cfg.payload, ctx.variables))
  // Raw WS has no channel/event — the empty channel makes `send` do a plain
  // `ws.send(payload)` (vs socket.io's `emit(channel, payload)`).
  const ok = ctx.socketio.send(connectionNodeId, '', payload)
  if (!ok) throw new Error('websocketSend: the referenced connection is not open')
  return { outputs: [] }
}

/** C (websocketClose): close the referenced connection (same as socketioClose). */
export const websocketCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('websocketClose: no connection selected')
  if (!ctx.socketio) throw new Error('websocketClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('websocketClose: the referenced connection does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/** B (socketioSend): emit on the referenced connection. */
export const socketioSendExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown; channel?: unknown; payload?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('socketioSend: no connection selected')
  if (!ctx.socketio) throw new Error('socketioSend: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('socketioSend: the referenced connection does not exist in this run')
  }
  // A wired `channel` / `payload` wins; otherwise the inline typed value.
  const channel = toWire(resolveOperand(act.inputs['channel'], cfg.channel, ctx.variables))
  const payload = toWire(resolveOperand(act.inputs['payload'], cfg.payload, ctx.variables))
  const ok = ctx.socketio.send(connectionNodeId, channel, payload)
  if (!ok) throw new Error('socketioSend: the referenced connection is not open')
  // No value output — sequencing is the universal `done` port (the send's
  // outcome is simply that it completed).
  return { outputs: [] }
}

/** C (socketioClose): close the referenced connection. */
export const socketioCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('socketioClose: no connection selected')
  if (!ctx.socketio) throw new Error('socketioClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('socketioClose: the referenced connection does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  // No value output — sequencing is the universal `done` port.
  return { outputs: [] }
}
