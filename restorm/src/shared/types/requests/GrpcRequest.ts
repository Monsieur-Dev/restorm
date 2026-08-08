import type { BaseRequest } from './BaseRequest'
import type { GrpcCallType, GrpcTransport } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

/**
 * One hosted method on a gRPC mock server: how restorm answers calls to
 * `service/method`. A canned `responseMessage` (a JSON string) is returned for
 * a successful call; a non-OK `statusCode` (with optional `statusMessage` +
 * `trailers`) makes the method fail with that gRPC status instead; an optional
 * `script` (a JS body, like the scenario `code` node) computes the response from
 * the received request for dynamic mocks. `callType` is the method's streaming
 * shape — it must match the proto, and decides how the handler is wired.
 */
export interface GrpcMockMethod {
  /** Fully-qualified service name (e.g. `grpcbin.GRPCBin`). */
  service: string
  /** Method name on that service (e.g. `DummyUnary`). */
  method: string
  /** The method's streaming shape (mirrors the proto's request/response flags). */
  callType: GrpcCallType
  /** Canned response message (a JSON string) returned on a successful call. For
   * a server/bidi-streaming method this may be a JSON array of frames. */
  responseMessage: string
  /** gRPC status code to answer with (0 = OK; non-zero = an error status). */
  statusCode?: number
  /** Optional status detail message paired with a non-OK `statusCode`. */
  statusMessage?: string
  /** Optional response trailers (gRPC metadata) sent alongside the status. */
  trailers?: KeyValue[]
  /** Optional JS body (a `code`-node-style script) computing the response from
   * the received request. When present it wins over `responseMessage`. */
  script?: string
}

export interface GrpcRequest extends BaseRequest {
  type: 'grpc'
  url: string
  service: string
  method: string
  callType: GrpcCallType
  requestMessage: string
  metadata: KeyValue[]
  /** The wire transport to dispatch over. `'grpc'` is the native HTTP/2
   * client and the default for a new request. */
  transport: GrpcTransport
  /** When true, restorm ACTS AS a local gRPC mock server: it hosts an
   * `@grpc/grpc-js` server on `localhost:<port>`, loads the request's proto, and
   * answers the methods configured in `mockMethods` instead of calling out as a
   * client. The URL then carries only `localhost:<port>` (host is fixed). */
  server?: boolean
  /** Per-method mock configuration (server mode). */
  mockMethods?: GrpcMockMethod[]
  /** Inline `.proto` descriptor content the mock server loads (server mode). */
  protoContent?: string
  /** Path to a `.proto` file on disk the mock server loads (server mode). */
  protoPath?: string
  /** Base64-encoded, serialized `google.protobuf.FileDescriptorSet` fetched
   * via gRPC server reflection (client mode). Set on import via reflection
   * and refreshed by "Refresh from reflection" so the request executes — and
   * its methods stay browsable — offline, from the exact bundle the server
   * returned. Takes precedence over `protoContent`/`protoPath` when
   * resolving the proto for execution (see `grpcProtoLoader.loadGrpcPackage`). */
  protoDescriptorSet?: string
  /** Serve the standard gRPC ServerReflection service so a client can discover
   * methods without the `.proto` (server mode; defaults to true). */
  reflection?: boolean
  /** Use TLS (a server certificate) instead of an insecure channel (server
   * mode). The cert + key are PEM strings. */
  tls?: boolean
  /** PEM server certificate (TLS server mode). */
  tlsCertPem?: string
  /** PEM private key (TLS server mode). */
  tlsKeyPem?: string
}
