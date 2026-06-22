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

/** A (mqttConnect): MQTT — same handoff as websocketConnect (no events; every
 * received message routes to the single `message` port). The bridge subscribes
 * to the bound request's topic on connect. */
export const mqttConnectExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`mqttConnect node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'mqtt', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** B (mqttSend): publish a payload on the referenced connection (to its topic). */
export const mqttSendExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown; payload?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('mqttSend: no connection selected')
  if (!ctx.socketio) throw new Error('mqttSend: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('mqttSend: the referenced connection does not exist in this run')
  }
  const payload = toWire(resolveOperand(act.inputs['payload'], cfg.payload, ctx.variables))
  // Empty channel → publish to the connection's own topic (set at connect).
  const ok = ctx.socketio.send(connectionNodeId, '', payload)
  if (!ok) throw new Error('mqttSend: the referenced connection is not open')
  return { outputs: [] }
}

/** C (mqttClose): close the referenced connection (same as websocketClose). */
export const mqttCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('mqttClose: no connection selected')
  if (!ctx.socketio) throw new Error('mqttClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('mqttClose: the referenced connection does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/** A (grpcConnect): gRPC streaming — same handoff as websocketConnect. The
 * call type (server / client / bidi) is inferred from the bound request, so
 * every received frame routes to the single `message` port. */
export const grpcConnectExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`grpcConnect node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'grpc', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** B (grpcSend): write a request message (no channel) on the referenced call. */
export const grpcSendExecutor: NodeExecutor = (act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown; payload?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('grpcSend: no connection selected')
  if (!ctx.socketio) throw new Error('grpcSend: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('grpcSend: the referenced connection does not exist in this run')
  }
  const payload = toWire(resolveOperand(act.inputs['payload'], cfg.payload, ctx.variables))
  // gRPC has no channel — the empty channel makes the bridge do a plain
  // `grpc.send(payload)` (a stream write), like raw WS.
  const ok = ctx.socketio.send(connectionNodeId, '', payload)
  if (!ok) throw new Error('grpcSend: the referenced connection is not open')
  return { outputs: [] }
}

/** C (grpcClose): half-close the referenced streaming call. */
export const grpcCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('grpcClose: no connection selected')
  if (!ctx.socketio) throw new Error('grpcClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('grpcClose: the referenced connection does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/**
 * A (httpListen): HOST a local HTTP mock server. A DISTINCT long-lived listener
 * — NOT a one-shot httpRequest with a flag. Hands the server off to the scheduler
 * via the `http-server` transport: the scheduler keeps the run alive while it
 * listens, fires `connected` once it is up, re-emits each SERVED request on
 * `served`, and fires `done` when an httpClose (or a Stop) ends it. Shares the
 * connect/close scope machinery, NOT request-execution code.
 */
export const httpListenExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`httpListen node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'http-server', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** C (httpClose): stop the HTTP mock server named by `config.connectionNodeId`
 * (firing that httpListen node's `done`). Pure-event action; sequences via its
 * own `done`. Errors when no server is selected or it is not listening. */
export const httpCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('httpClose: no server selected')
  if (!ctx.socketio) throw new Error('httpClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('httpClose: the referenced server does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/**
 * A (grpcListen): HOST a local gRPC mock server (its own @grpc/grpc-js Server) —
 * a DISTINCT long-lived listener, NOT a one-shot grpcConnect. Hands the server
 * off to the scheduler via the `grpc-server` transport: the scheduler keeps the
 * run alive while it listens, fires `connected` once it is up, re-emits each
 * SERVED call on `served`, and fires `done` when a grpcServerClose (or a Stop)
 * ends it. Shares the connect/close scope machinery, NOT request-execution code.
 */
export const grpcListenExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`grpcListen node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'grpc-server', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** C (grpcServerClose): stop the gRPC mock server named by `config.connectionNodeId`
 * (firing that grpcListen node's `done`). Pure-event action; sequences via its
 * own `done`. Errors when no server is selected or it is not listening. */
export const grpcServerCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('grpcServerClose: no server selected')
  if (!ctx.socketio) throw new Error('grpcServerClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('grpcServerClose: the referenced server does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/**
 * A (soapListen): HOST a local SOAP mock server. DERIVES from httpListen — same
 * long-lived listener machinery, but the `soap-server` transport answers SOAP
 * envelopes (operation dispatch + `<soap:Fault>`). `connected` fires once the
 * server is up, each SERVED request re-emits on `served`, and `done` fires when
 * a soapClose (or a Stop) ends it.
 */
export const soapListenExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`soapListen node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'soap-server', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** C (soapClose): stop the SOAP mock server named by `config.connectionNodeId`
 * (firing that soapListen node's `done`). DERIVES from httpClose. */
export const soapCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('soapClose: no server selected')
  if (!ctx.socketio) throw new Error('soapClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('soapClose: the referenced server does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/**
 * A (graphqlListen): HOST a local GraphQL mock server. A DISTINCT long-lived
 * listener — NOT a one-shot request with a flag. Hands the server off to the
 * scheduler via the `graphql-server` transport: the scheduler keeps the run
 * alive while it listens, fires `connected` once it is up, re-emits each SERVED
 * operation on `served`, and fires `done` when a graphqlClose (or a Stop) ends
 * it. Mirrors {@link httpListenExecutor}.
 */
export const graphqlListenExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`graphqlListen node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'graphql-server', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** C (graphqlClose): stop the GraphQL mock server named by
 * `config.connectionNodeId` (firing that graphqlListen node's `done`).
 * Pure-event action; sequences via its own `done`. Errors when no server is
 * selected or it is not listening. */
export const graphqlCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('graphqlClose: no server selected')
  if (!ctx.socketio) throw new Error('graphqlClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('graphqlClose: the referenced server does not exist in this run')
  }
  ctx.socketio.close(connectionNodeId)
  return { outputs: [] }
}

/**
 * A (odataListen): HOST a local OData v4 mock service (its routes on the shared
 * HTTP PortHost) — a DISTINCT long-lived listener, NOT a one-shot request. Hands
 * the service off to the scheduler via the `odata-server` transport: the
 * scheduler keeps the run alive while it listens, fires `connected` once it is
 * up, re-emits each SERVED request on `served`, and fires `done` when an
 * odataClose (or a Stop) ends it. Shares the connect/close scope machinery.
 */
export const odataListenExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { requestId?: unknown; connectionName?: unknown }
  if (typeof cfg.requestId !== 'string' || cfg.requestId === '') {
    throw new Error(`odataListen node ${ctx.node.id} has no bound requestId`)
  }
  const connectionName = typeof cfg.connectionName === 'string' && cfg.connectionName.trim() !== ''
    ? cfg.connectionName.trim()
    : cfg.requestId
  return {
    outputs: [],
    scopeAction: { type: 'openSocketioConnect', transport: 'odata-server', requestId: cfg.requestId, events: [], connectionName }
  }
}

/** C (odataClose): stop the OData mock service named by `config.connectionNodeId`
 * (firing that odataListen node's `done`). Pure-event action; sequences via its
 * own `done`. Errors when no server is selected or it is not listening. */
export const odataCloseExecutor: NodeExecutor = (_act, ctx) => {
  const cfg = ctx.node.config as { connectionNodeId?: unknown }
  const connectionNodeId = typeof cfg.connectionNodeId === 'string' ? cfg.connectionNodeId : ''
  if (connectionNodeId === '') throw new Error('odataClose: no server selected')
  if (!ctx.socketio) throw new Error('odataClose: socket bridge unavailable')
  if (!ctx.socketio.has(connectionNodeId)) {
    throw new Error('odataClose: the referenced server does not exist in this run')
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
