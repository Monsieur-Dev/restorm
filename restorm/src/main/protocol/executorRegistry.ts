import type { RequestType } from '../../shared/protocolRegistry'
import { httpExecutionService } from '../services/HTTPExecutionService'
import { graphqlExecutionService } from '../services/GraphQLExecutionService'
import { soapExecutionService } from '../services/SOAPExecutionService'
import { grpcExecutionService } from '../services/GRPCExecutionService'
import { websocketExecutionService } from '../services/WebSocketExecutionService'
import { jsonRpcExecutionService } from '../services/JsonRpcExecutionService'
import { sseExecutionService } from '../services/SseExecutionService'
import { amqpExecutionService } from '../services/AMQPExecutionService'
import { redisExecutionService } from '../services/RedisExecutionService'
import { stompExecutionService } from '../services/StompExecutionService'
import { kafkaExecutionService } from '../services/KafkaExecutionService'

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
/**
 * The live frame buffer of a streaming protocol, as the MCP streaming path
 * reads it. Every streaming execution service already exposes this pair; naming
 * it here is what lets `run_request` / `read_stream` serve a protocol without
 * knowing which service backs it — they used to call
 * `websocketExecutionService` directly, so an SSE run polled the WebSocket
 * buffer, found nothing, and reported zero frames on a healthy connection.
 */
export interface ProtocolStreamSource {
  getMessages(requestId: string, afterIndex?: number): { frames: unknown[]; total: number } | null
  isActive(requestId: string): boolean
}

export interface ProtocolExecutor {
  /** A long-lived streaming protocol: run via the streaming path and abort via
   * `disconnect` rather than `cancel`. Default (unary) protocols run one-shot. */
  readonly streaming: boolean
  /** Abort an in-flight execution for this request id; returns whether anything
   * was actually cancelled (safe to call when nothing is in flight). */
  cancel(requestId: string): boolean
  /** Live frame buffer — required for `streaming: true`, absent otherwise. */
  readonly stream?: ProtocolStreamSource
}

export const PROTOCOL_EXECUTORS: Record<RequestType, ProtocolExecutor> = {
  http: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  odata: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  auth: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  trpc: { streaming: false, cancel: (id) => httpExecutionService.cancel(id) },
  graphql: { streaming: false, cancel: (id) => graphqlExecutionService.cancel(id) },
  soap: { streaming: false, cancel: (id) => soapExecutionService.cancel(id) },
  grpc: { streaming: false, cancel: (id) => grpcExecutionService.cancel(id) },
  websocket: { streaming: true, cancel: (id) => websocketExecutionService.disconnect(id), stream: websocketExecutionService },
  jsonrpc: { streaming: false, cancel: (id) => jsonRpcExecutionService.cancel(id) },
  jsonrpcBatch: { streaming: false, cancel: (id) => jsonRpcExecutionService.cancel(id) },
  sse: { streaming: true, cancel: (id) => sseExecutionService.disconnect(id), stream: sseExecutionService },
  // `streaming: false` even though `subscribe` mode is a long-lived connection:
  // the MCP `run_request` streaming path is hardcoded to the WebSocket family
  // (buffer polling + continuation tokens over `websocketExecutionService`) —
  // same reason gRPC's streaming call types stay `false` here today. `cancel`
  // still correctly disconnects an open subscribe connection.
  amqp: { streaming: false, cancel: (id) => amqpExecutionService.disconnect(id) },
  // `streaming: false` even though subscribe mode is long-lived: command mode
  // is naturally unary, and subscribe mode's "run" stores ONE history entry on
  // connect (mirroring websocket's connect-time store), so the generic
  // run_request MCP tool's wait-for-history-entry path resolves for both modes.
  // Live per-message MCP polling (read_stream) is not wired for redis subscribe
  // — no AC requires it, and it would mean routing execute.ts's streaming path
  // through a Redis-specific branch instead of appending here.
  redis: { streaming: false, cancel: (id) => redisExecutionService.cancel(id) },
  // STOMP's live connection is driven the same way as gRPC/SOAP from MCP's
  // perspective: `run_request` dispatches the panel's Connect button and waits
  // for a new history entry (persisted when the connection closes), rather
  // than the WS-only frame-polling path (`read_stream`/`send_message` are
  // hardcoded to `websocketExecutionService` today). The scenario engine's
  // `stompConnect` node still gets full streaming via `connectStreamingStomp`.
  stomp: { streaming: false, cancel: (id) => stompExecutionService.disconnect(id), stream: stompExecutionService },
  // `streaming: false` even though consume mode is long-lived: the MCP
  // `run_request` streaming path (`runStreamingWebsocketRequest`) is
  // websocket-specific, not generic by transport — gRPC's own streaming call
  // types made the same choice here for the same reason. `cancel` still
  // uniformly aborts whichever of produce/browse/consume is in flight.
  kafka: { streaming: false, cancel: (id) => kafkaExecutionService.cancel(id) }
}

/** The execution dispatch for a protocol discriminant. */
export function protocolExecutor(type: RequestType): ProtocolExecutor {
  return PROTOCOL_EXECUTORS[type]
}
