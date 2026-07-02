import type { RequestType } from '../../shared/protocolRegistry'
import { httpExecutionService } from '../services/HTTPExecutionService'
import { graphqlExecutionService } from '../services/GraphQLExecutionService'
import { soapExecutionService } from '../services/SOAPExecutionService'
import { grpcExecutionService } from '../services/GRPCExecutionService'
import { websocketExecutionService } from '../services/WebSocketExecutionService'
import { jsonRpcExecutionService } from '../services/JsonRpcExecutionService'
import { sseExecutionService } from '../services/SseExecutionService'
import { amqpExecutionService } from '../services/AMQPExecutionService'

/**
 * The MAIN-process execution dispatch for each protocol type — the main-only
 * sibling of the class-free {@link PROTOCOL_REGISTRY} (kept separate because the
 * execution services import sockets / fs / gRPC and must never reach the
 * renderer bundle). A drift-guard test cross-checks this map covers exactly the
 * shared registry's key set, so a protocol added to the metadata registry
 * without an executor entry fails the test rather than falling through a
 * `switch` default at runtime.
 *
 * `auth`, `odata`, and `trpc` deliberately COMPOSE onto the HTTP execution
 * service (auth is an HTTP prefetch; OData is HTTP with `$`-query
 * serialisation; tRPC is HTTP with a v10 wire-format envelope) — the same
 * mapping the previous per-tool `switch` statements encoded.
 *
 * A new protocol appends ONE entry here — no execute/cancel `switch` to touch.
 */
export interface ProtocolExecutor {
  /** A long-lived streaming protocol: run via the streaming path and abort via
   * `disconnect` rather than `cancel`. Default (unary) protocols run one-shot. */
  readonly streaming: boolean
  /** Abort an in-flight execution for this request id; returns whether anything
   * was actually cancelled (safe to call when nothing is in flight). */
  cancel(requestId: string): boolean
}

export const PROTOCOL_EXECUTORS: Record<RequestType, ProtocolExecutor> = {
  http: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  odata: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  auth: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  trpc: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  graphql: { streaming: false, cancel: (id) => graphqlExecutionService.cancel(id) },
  soap: { streaming: false, cancel: (id) => soapExecutionService.cancel(id) },
  grpc: { streaming: false, cancel: (id) => grpcExecutionService.cancel(id) },
  websocket: { streaming: true, cancel: (id) => websocketExecutionService.disconnect(id) },
  jsonrpc: { streaming: false, cancel: (id) => jsonRpcExecutionService.cancel(id) },
  jsonrpcBatch: { streaming: false, cancel: (id) => jsonRpcExecutionService.cancel(id) },
  sse: { streaming: true, cancel: (id) => sseExecutionService.disconnect(id) },
  // `streaming: false` even though `subscribe` mode is a long-lived connection:
  // the MCP `run_request` streaming path is hardcoded to the WebSocket family
  // (buffer polling + continuation tokens over `websocketExecutionService`) —
  // same reason gRPC's streaming call types stay `false` here today. `cancel`
  // still correctly disconnects an open subscribe connection.
  amqp: { streaming: false, cancel: (id) => amqpExecutionService.disconnect(id) }
}

/** The execution dispatch for a protocol discriminant. */
export function protocolExecutor(type: RequestType): ProtocolExecutor {
  return PROTOCOL_EXECUTORS[type]
}
