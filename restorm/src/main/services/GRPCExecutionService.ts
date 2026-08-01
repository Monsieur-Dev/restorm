/**
 * gRPC Execution Service
 *
 * Real gRPC execution in the main process via `@grpc/grpc-js` +
 * `@grpc/proto-loader`, covering all four call types:
 *  - **unary**            request → single response.
 *  - **server-stream**    one request → a stream of response frames.
 *  - **client-stream**    a stream of request messages → one final response.
 *  - **bidi**             full-duplex; either side may end.
 *
 * The streaming surface mirrors `WebSocketExecutionService`: `connectStreaming`
 * opens a long-lived call for the scenario engine + the request panel's Connect
 * button, streaming its lifecycle through `onConnect` / `onMessage` / `onClose`
 * callbacks and returning a `{ send, close, isOpen }` handle. Received frames are
 * persisted to `ResponseHistoryService` so a `grpcConnect` node's preview + the
 * response panel can read them, exactly like the WebSocket path.
 *
 * The proto descriptor is resolved per request (inline content, a `.proto` path,
 * or the bundled grpcbin fallback) — see `grpc/grpcProtoLoader.ts`.
 */

import { BrowserWindow } from 'electron'
import * as grpc from '@grpc/grpc-js'
import type { ClientReadableStream, ClientWritableStream, ClientDuplexStream } from '@grpc/grpc-js'
import { logger, withFirewallBypass } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { responseHistoryService } from './ResponseHistoryService'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { resolveGrpcMethod, grpcStatusName, type ProtoSource } from './grpc/grpcProtoLoader'
import { encodeGrpcWebFrame } from './grpc/grpcWebCodec'
import { executeGrpcWebRequest, grpcWebStatus } from './grpc/grpcWebTransport'
import { executeConnectUnary, executeConnectStream, connectStatusFromError } from './grpc/connectTransport'
import { DEFAULT_WS_TIMEOUT_MS } from '../../shared/config/constants'

/** gRPC request execution input */
export interface GRPCExecutionInput {
  requestId: string
  timeout?: number
}

/** A single gRPC frame (a sent request message or a received response message). */
export interface GrpcMessage {
  direction: 'sent' | 'received'
  data: string
  timestamp: string
}

/** gRPC response result */
export interface GRPCExecutionResult {
  requestId: string
  success: boolean
  /** Whether the call/stream opened (analogue of WebSocket `connected`). */
  connected: boolean
  statusCode?: number
  statusMessage?: string
  /** The first/last response message (unary + client-stream final). */
  responseMessage?: string
  /** Every frame exchanged on the call (sent + received), in order. */
  messages: GrpcMessage[]
  metadata?: Record<string, string>
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestMethod?: string
}

/** A gRPC call type (mirrors the request model union). */
type GrpcCallType = 'unary' | 'server-stream' | 'client-stream' | 'bidirectional-stream'

/** The wire transport (mirrors the request model union). */
type GrpcTransport = 'grpc' | 'grpc-web' | 'connect'

/** Everything-resolved shape both one-shot `execute()` and streaming need. */
interface ResolvedGrpcExecution {
  requestId: string
  timeout: number
  startTime: number
  startedAt: string
  /** host:port (scheme stripped). */
  address: string
  service: string
  method: string
  callType: GrpcCallType
  /** Absent on any request saved before this field existed — defaults to
   * the native transport, so backward compatibility needs no migration. */
  transport: GrpcTransport
  metadata: grpc.Metadata
  /** The resolved request message (JSON string). */
  resolvedMessage: string
  protoSource: ProtoSource
  /** Whether the channel should use TLS. */
  secure: boolean
}

/** A live streaming call (the scenario engine / panel Connect drives it). */
interface ActiveCall {
  requestId: string
  callType: GrpcCallType
  /** The underlying grpc call object (one of the four stream shapes). */
  stream: ClientReadableStream<object> | ClientWritableStream<object> | ClientDuplexStream<object, object>
  open: boolean
  messages: GrpcMessage[]
}

/** A live gRPC-Web/Connect streaming call — the HTTP-framed counterpart of
 * {@link ActiveCall}. Server-stream only (client/bidi need native gRPC), so
 * there's no writable stream to model: closing/cancelling is always an abort
 * of the underlying HTTP request. */
interface ActiveHttpFramedCall {
  controller: AbortController
  open: boolean
  messages: GrpcMessage[]
}

/** Strip a URL scheme + trailing slash, returning a bare `host:port` for
 * grpc-js. Exported so the reflection IPC handlers can apply the same
 * `grpcs://` → secure-channel convention a request already executes with. */
export function normalizeAddress(url: string): { address: string; secure: boolean } {
  let secure = false
  let address = url.trim()
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(address)
  if (schemeMatch) {
    const scheme = schemeMatch[1]?.toLowerCase() ?? ''
    secure = scheme === 'grpcs' || scheme === 'https'
    address = address.slice(schemeMatch[0].length)
  }
  return { address: address.replace(/\/+$/, ''), secure }
}

/**
 * Parse a user-typed message into a JS object for the wire. An empty message
 * is the valid empty request `{}`, but malformed JSON throws so the caller can
 * surface the error — silently sending `{}` would hide the user's mistake and
 * make the server reject a request the user thought they'd typed correctly.
 */
function parseMessage(raw: string): object {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Invalid request message: not valid JSON (${detail})`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid request message: expected a JSON object')
  }
  return parsed
}

/** The call type implied by a method's streaming flags in the proto. */
function callTypeFromStreaming(requestStream: boolean, responseStream: boolean): GrpcCallType {
  if (requestStream && responseStream) return 'bidirectional-stream'
  if (requestStream) return 'client-stream'
  if (responseStream) return 'server-stream'
  return 'unary'
}

/**
 * Reconcile the (user-supplied, hence untrusted) callType with the streaming
 * flags the proto actually declares for the method. The proto is ground truth:
 * dispatching a unary call down a streaming path (or vice versa) crashes deep
 * in grpc-js with an opaque error. Return the proto's call type, logging when
 * it disagrees with the request so a stale saved callType self-heals.
 */
function reconcileCallType(
  requested: GrpcCallType,
  requestStream: boolean,
  responseStream: boolean
): GrpcCallType {
  const actual = callTypeFromStreaming(requestStream, responseStream)
  if (actual !== requested) {
    logger.warn('[GRPCExecutionService] callType mismatch; using the proto-declared type', {
      requested,
      actual
    })
  }
  return actual
}

/** Flatten gRPC metadata to plain HTTP headers — gRPC-Web / Connect map custom
 * metadata directly onto HTTP headers, one-to-one. Binary (`-bin` suffixed)
 * metadata values aren't produced by this app's metadata editor, so a `Buffer`
 * value (defensive) is base64-encoded rather than dropped silently. */
function metadataToHeaders(metadata: grpc.Metadata): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, values] of Object.entries(metadata.getMap())) {
    headers[key] = Buffer.isBuffer(values) ? values.toString('base64') : values
  }
  return headers
}

/** Close a gRPC client (releasing its channel + sockets); best-effort. Each
 * call builds a fresh client, so it must be closed when the call settles or the
 * channel + keepalive timers leak for the process lifetime. */
function closeClient(client: grpc.Client | undefined): void {
  try {
    client?.close()
  } catch {
    // already closed / never opened
  }
}

/** Serialize a received gRPC message object to the string frame model. */
function stringifyMessage(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Service for executing gRPC requests in the main process.
 */
class GRPCExecutionService {
  /** Unary cancellation handles (one-shot execute). */
  private activeRequests = new Map<string, () => void>()
  /** Long-lived streaming calls (scenario engine / panel Connect) — native gRPC. */
  private activeCalls = new Map<string, ActiveCall>()
  /** Long-lived streaming calls over the gRPC-Web / Connect HTTP transports. */
  private activeHttpFramedCalls = new Map<string, ActiveHttpFramedCall>()

  /** Resolve a request into the everything-resolved shape, hydrating secrets. */
  private async resolveExecution(requestId: string, timeout: number): Promise<ResolvedGrpcExecution> {
    const startTime = Date.now()
    const startedAt = new Date().toISOString()

    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      throw new Error('No resolved URL found for this request. Make sure the request is registered.')
    }
    let resolvedUrl = urlResult.resolvedUrl

    const requestContext = contextService.getRequestContext(requestId)

    // Hydrate any SecretValues reachable from the request's KeyValue groups AND
    // the active env-folder chain BEFORE the synchronous metadata resolution.
    const envSecrets = contextService.collectEnvironmentSecrets(requestId)
    const secrets = [...collectRequestSecrets(requestContext?.keyValueGroups), ...envSecrets]
    if (secrets.length > 0) {
      await secretHydrationService.hydrate(requestId, secrets)
      if (envSecrets.length > 0) {
        contextService.refreshEnvironmentContext(requestId)
        resolvedUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? resolvedUrl
      }
    }

    // gRPC metadata is registered as the request's `headers` KeyValue group.
    const metadata = new grpc.Metadata()
    const headersGroup = requestContext?.keyValueGroups.get('headers')
    if (headersGroup) {
      for (const h of headersGroup) {
        if (h.enabled === false || !h.key) continue
        // The KEY resolves unconditionally through Handlebars, same as a
        // path/query param key or the URL — see `HTTPExecutionService`. The
        // VALUE stays type-aware: only ExpressionValue rows get
        // handlebars-substituted; a StringValue row ships verbatim.
        const resolvedKey = contextService.resolveValue(h.key, requestId)
        metadata.set(resolvedKey, contextService.resolveKeyValueForRequest(h, requestId))
      }
    }

    const full = requestContext?.fullData
    const service = (full?.service) ?? ''
    const method = (full?.grpcMethod) ?? (full?.method) ?? ''
    const callType = ((full?.callType) ?? 'unary') as GrpcCallType
    // Absent (any request saved before this field existed) means the native
    // transport — never silently reinterpreted as gRPC-Web/Connect.
    const transport = ((full?.transport) ?? 'grpc') as GrpcTransport
    const message = (full?.requestMessage) ?? '{}'
    const resolvedMessage = contextService.resolveValue(message, requestId)
    const protoSource: ProtoSource = {
      protoDescriptorSet: full?.protoDescriptorSet,
      protoContent: full?.protoContent,
      protoPath: full?.protoPath
    }
    const { address, secure } = normalizeAddress(resolvedUrl)

    return {
      requestId,
      timeout,
      startTime,
      startedAt,
      address,
      service,
      method,
      callType,
      transport,
      metadata,
      resolvedMessage,
      protoSource,
      secure
    }
  }

  private credentials(secure: boolean): grpc.ChannelCredentials {
    return secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
  }

  private callOptions(timeout: number): grpc.CallOptions {
    return { deadline: Date.now() + timeout }
  }

  /**
   * One-shot execution: fire the configured request message once and collect
   * everything. Unary → single response; server-stream → all frames until the
   * server closes; client/bidi → send the one message, half-close, collect the
   * response(s). Interactive multi-send uses {@link connectStreaming} instead.
   */
  async execute(input: GRPCExecutionInput): Promise<GRPCExecutionResult> {
    const { requestId, timeout = DEFAULT_WS_TIMEOUT_MS } = input
    const startedAt = new Date().toISOString()
    const startTime = Date.now()

    let resolved: ResolvedGrpcExecution
    try {
      resolved = await this.resolveExecution(requestId, timeout)
    } catch (err) {
      return this.failure(requestId, (err as Error).message, { startedAt, durationMs: Date.now() - startTime })
    }

    logger.info('[GRPCExecutionService] Executing', {
      requestId,
      address: resolved.address,
      method: `${resolved.service}/${resolved.method}`,
      callType: resolved.callType
    })
    this.broadcastProgress(requestId, 'started')

    try {
      if (resolved.transport !== 'grpc') return await this.runHttpFramedOneShot(resolved)
      if (resolved.callType === 'unary') return await this.executeUnary(resolved)
      return await this.executeStreamingOneShot(resolved)
    } catch (err) {
      this.broadcastProgress(requestId, 'error')
      return this.failure(requestId, (err as Error).message, resolved, false)
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  private failure(
    requestId: string,
    error: string,
    timingsOrResolved: { startedAt: string; durationMs: number } | ResolvedGrpcExecution,
    connected = false
  ): GRPCExecutionResult {
    const isResolved = 'startTime' in timingsOrResolved
    const timings = isResolved
      ? { startedAt: timingsOrResolved.startedAt, durationMs: Date.now() - timingsOrResolved.startTime }
      : timingsOrResolved
    return {
      requestId,
      success: false,
      connected,
      messages: [],
      error,
      ...(isResolved ? { requestUrl: timingsOrResolved.address, requestMethod: `${timingsOrResolved.service}/${timingsOrResolved.method}` } : {}),
      timings
    }
  }

  /** Build the common result fields for a resolved call. */
  private resultBase(resolved: ResolvedGrpcExecution): Pick<GRPCExecutionResult, 'requestId' | 'requestUrl' | 'requestMethod'> {
    return {
      requestId: resolved.requestId,
      requestUrl: resolved.address,
      requestMethod: `${resolved.service}/${resolved.method}`
    }
  }

  private executeUnary(resolved: ResolvedGrpcExecution): Promise<GRPCExecutionResult> {
    const { requestId, service, method, address, metadata, resolvedMessage, protoSource, secure, timeout } = resolved
    return new Promise((resolve) => {
      let settled = false
      let activeClient: grpc.Client | undefined
      const finish = (result: GRPCExecutionResult): void => {
        if (settled) return
        settled = true
        closeClient(activeClient)
        this.persistHistory(requestId, result)
        resolve(result)
      }

      let client: ReturnType<typeof resolveGrpcMethod>['client']
      try {
        const resolvedMethod = resolveGrpcMethod(protoSource, address, service, method, this.credentials(secure))
        client = resolvedMethod.client
        // The proto is ground truth: if the method is actually streaming,
        // dispatching it as unary would crash deep in grpc-js with an opaque
        // error. Reconcile and surface a clear failure instead.
        const actual = reconcileCallType('unary', resolvedMethod.requestStream, resolvedMethod.responseStream)
        if (actual !== 'unary') {
          this.broadcastProgress(requestId, 'error')
          closeClient(client)
          finish(this.failure(requestId, `proto declares '${actual}' but request was dispatched as unary`, resolved))
          return
        }
        activeClient = client
      } catch (err) {
        this.broadcastProgress(requestId, 'error')
        finish(this.failure(requestId, (err as Error).message, resolved))
        return
      }

      const messages: GrpcMessage[] = []
      let reqObj: object
      try {
        reqObj = parseMessage(resolvedMessage)
      } catch (err) {
        this.broadcastProgress(requestId, 'error')
        finish(this.failure(requestId, (err as Error).message, resolved))
        return
      }
      const sent: GrpcMessage = { direction: 'sent', data: resolvedMessage, timestamp: new Date().toISOString() }
      messages.push(sent)
      this.broadcastMessage(requestId, sent)

      const cancellable = client[method](reqObj, metadata, this.callOptions(timeout), (err: grpc.ServiceError | null, response: object) => {
        if (err) {
          this.broadcastProgress(requestId, 'error')
          finish({
            ...this.resultBase(resolved),
            success: false,
            connected: true,
            statusCode: err.code,
            statusMessage: grpcStatusName(err.code),
            messages,
            error: err.details || err.message,
            timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
          })
          return
        }
        const data = stringifyMessage(response)
        const recv: GrpcMessage = { direction: 'received', data, timestamp: new Date().toISOString() }
        messages.push(recv)
        this.broadcastMessage(requestId, recv)
        this.broadcastProgress(requestId, 'completed')
        finish({
          ...this.resultBase(resolved),
          success: true,
          connected: true,
          statusCode: grpc.status.OK,
          statusMessage: grpcStatusName(grpc.status.OK),
          responseMessage: data,
          messages,
          timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
        })
      }) as { cancel?: () => void }
      this.activeRequests.set(requestId, () => cancellable.cancel?.())
    })
  }

  /** Server/client/bidi one-shot: send the single configured message, collect frames. */
  private executeStreamingOneShot(resolved: ResolvedGrpcExecution): Promise<GRPCExecutionResult> {
    return new Promise((resolve) => {
      const messages: GrpcMessage[] = []
      let settled = false
      let statusCode = grpc.status.OK
      let errorMsg: string | undefined
      let activeClient: grpc.Client | undefined

      const finish = (): void => {
        if (settled) return
        settled = true
        closeClient(activeClient)
        const success = errorMsg === undefined && statusCode === grpc.status.OK
        const received = messages.filter((m) => m.direction === 'received')
        const result: GRPCExecutionResult = {
          ...this.resultBase(resolved),
          success,
          connected: true,
          statusCode,
          statusMessage: grpcStatusName(statusCode),
          ...(received.length > 0 ? { responseMessage: received[received.length - 1]?.data } : {}),
          messages,
          ...(errorMsg !== undefined ? { error: errorMsg } : {}),
          timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
        }
        this.broadcastProgress(requestId, success ? 'completed' : 'error')
        this.persistHistory(requestId, result)
        resolve(result)
      }

      const { requestId, service, method, address, metadata, resolvedMessage, protoSource, secure, callType: requestedCallType } = resolved
      let client: ReturnType<typeof resolveGrpcMethod>['client']
      let callType = requestedCallType
      try {
        const resolvedMethod = resolveGrpcMethod(protoSource, address, service, method, this.credentials(secure))
        client = resolvedMethod.client
        // Trust the proto's streaming flags over the request's (possibly stale)
        // callType, so a unary method never gets dispatched down a stream path.
        callType = reconcileCallType(requestedCallType, resolvedMethod.requestStream, resolvedMethod.responseStream)
        activeClient = client
      } catch (err) {
        errorMsg = (err as Error).message
        statusCode = grpc.status.UNKNOWN
        finish()
        return
      }

      const recordSent = (data: string): void => {
        const sent: GrpcMessage = { direction: 'sent', data, timestamp: new Date().toISOString() }
        messages.push(sent)
        this.broadcastMessage(requestId, sent)
      }
      const recordReceived = (response: object): void => {
        const recv: GrpcMessage = { direction: 'received', data: stringifyMessage(response), timestamp: new Date().toISOString() }
        messages.push(recv)
        this.broadcastMessage(requestId, recv)
      }
      const onError = (err: grpc.ServiceError): void => {
        statusCode = err.code
        errorMsg = err.details || err.message
        finish()
      }

      let reqObj: object
      try {
        reqObj = parseMessage(resolvedMessage)
      } catch (err) {
        errorMsg = (err as Error).message
        statusCode = grpc.status.INVALID_ARGUMENT
        finish()
        return
      }

      if (callType === 'server-stream') {
        recordSent(resolvedMessage)
        const stream = client[method](reqObj, metadata, this.callOptions(resolved.timeout)) as ClientReadableStream<object>
        this.activeRequests.set(requestId, () => { stream.cancel(); })
        stream.on('data', recordReceived)
        stream.on('error', onError)
        stream.on('end', finish)
        return
      }

      // client-stream / bidi: open, send the one message, half-close, collect.
      if (callType === 'client-stream') {
        const stream = client[method](metadata, this.callOptions(resolved.timeout), (err: grpc.ServiceError | null, response: object) => {
          if (err) { onError(err); return }
          recordReceived(response)
          finish()
        }) as ClientWritableStream<object>
        this.activeRequests.set(requestId, () => { stream.cancel(); })
        recordSent(resolvedMessage)
        stream.write(reqObj)
        stream.end()
        return
      }

      // bidirectional-stream
      const stream = client[method](metadata, this.callOptions(resolved.timeout)) as ClientDuplexStream<object, object>
      this.activeRequests.set(requestId, () => { stream.cancel(); })
      stream.on('data', recordReceived)
      stream.on('error', onError)
      stream.on('end', finish)
      recordSent(resolvedMessage)
      stream.write(reqObj)
      stream.end()
    })
  }

  /**
   * Core gRPC-Web dispatch shared by the one-shot `execute()` path and the
   * long-lived `connectStreaming()` path: resolves the method from the
   * request's proto, serialises the one configured request message, POSTs the
   * gRPC-Web-framed body, and reports each decoded response frame via
   * `onFrame` as it arrives. Resolves with the final gRPC status once the
   * HTTP response ends (trailers parsed); throws on a hard failure (proto
   * resolution, invalid JSON message, a proto-declared client/bidi method the
   * transport can't carry, or a network/timeout error) — callers shape that
   * into a `GRPCExecutionResult` or a `fireClose(error)` as appropriate.
   */
  private async dispatchGrpcWeb(
    resolved: ResolvedGrpcExecution,
    callbacks: { onSent: (data: string) => void; onFrame: (payload: object) => void },
    signal: AbortSignal
  ): Promise<{ statusCode: grpc.status; statusMessage: string }> {
    const resolvedMethod = resolveGrpcMethod(resolved.protoSource, resolved.address, resolved.service, resolved.method, this.credentials(resolved.secure))
    // The proto is ground truth: gRPC-Web can carry unary + server-stream
    // only, regardless of what the (possibly stale) saved callType claims.
    const actualCallType = reconcileCallType(resolved.callType, resolvedMethod.requestStream, resolvedMethod.responseStream)
    if (actualCallType === 'client-stream' || actualCallType === 'bidirectional-stream') {
      throw new Error(`proto declares '${actualCallType}', which gRPC-Web cannot carry over HTTP/1.1 — use the native gRPC transport`)
    }
    const reqObj = parseMessage(resolved.resolvedMessage)
    callbacks.onSent(resolved.resolvedMessage)
    // Same trust tier as the Send button dispatching a plain HTTP request
    // (see `HTTPExecutionService.dispatchOnce`): the user already authorised
    // this call by clicking Send/Connect, so it bypasses the firewall rather
    // than re-prompting (or hanging, off the e2e-only bypass flag) on a host
    // not yet on the whitelist.
    const httpResult = await withFirewallBypass(() => executeGrpcWebRequest({
      address: resolved.address,
      secure: resolved.secure,
      path: resolvedMethod.path,
      headers: metadataToHeaders(resolved.metadata),
      body: encodeGrpcWebFrame(resolvedMethod.requestSerialize(reqObj)),
      timeoutMs: resolved.timeout,
      signal,
      onData: (payload) => { callbacks.onFrame(resolvedMethod.responseDeserialize(payload)) }
    }))
    return grpcWebStatus(httpResult)
  }

  /**
   * Core Connect-RPC dispatch, mirroring `dispatchGrpcWeb`: resolves the
   * proto method for its path + streaming shape only (Connect speaks JSON
   * on the wire, so there's no protobuf serialize/deserialize step — the
   * already-parsed request/response JSON goes straight through), then
   * dispatches to the unary or server-streaming HTTP call depending on the
   * reconciled call type.
   */
  private async dispatchConnect(
    resolved: ResolvedGrpcExecution,
    callbacks: { onSent: (data: string) => void; onFrame: (payload: object) => void },
    signal: AbortSignal
  ): Promise<{ statusCode: grpc.status; statusMessage: string }> {
    const resolvedMethod = resolveGrpcMethod(resolved.protoSource, resolved.address, resolved.service, resolved.method, this.credentials(resolved.secure))
    // Same rationale as gRPC-Web: the proto is ground truth, and Connect over
    // plain HTTP/1.1 can carry unary + server-stream only.
    const actualCallType = reconcileCallType(resolved.callType, resolvedMethod.requestStream, resolvedMethod.responseStream)
    if (actualCallType === 'client-stream' || actualCallType === 'bidirectional-stream') {
      throw new Error(`proto declares '${actualCallType}', which this Connect implementation cannot carry over HTTP/1.1 — use the native gRPC transport`)
    }
    // Validate the message is well-formed JSON before dispatch (Connect sends
    // it verbatim, no protobuf hop) — same fail-fast contract as gRPC-Web.
    parseMessage(resolved.resolvedMessage)
    callbacks.onSent(resolved.resolvedMessage)
    const requestOptions = {
      address: resolved.address,
      secure: resolved.secure,
      path: resolvedMethod.path,
      headers: metadataToHeaders(resolved.metadata),
      timeoutMs: resolved.timeout,
      signal
    }
    // Same rationale as `dispatchGrpcWeb`: the user already authorised this
    // call by clicking Send/Connect, so it bypasses the firewall.
    if (actualCallType === 'unary') {
      const result = await withFirewallBypass(() => executeConnectUnary({ ...requestOptions, body: resolved.resolvedMessage }))
      if (result.ok) callbacks.onFrame((result.message ?? {}) as object)
      return connectStatusFromError(result.error)
    }
    const streamResult = await withFirewallBypass(() => executeConnectStream({
      ...requestOptions,
      body: resolved.resolvedMessage,
      onMessage: (payload) => { callbacks.onFrame(payload as object) }
    }))
    return connectStatusFromError(streamResult.error)
  }

  /** Bind the transport-appropriate dispatch function — shared by the
   * one-shot `execute()` path and the long-lived `connectStreaming()` path
   * so neither has to duplicate the `transport === 'grpc-web' ? … : …` check. */
  private httpFramedDispatch(transport: GrpcTransport): (
    resolved: ResolvedGrpcExecution,
    callbacks: { onSent: (data: string) => void; onFrame: (payload: object) => void },
    signal: AbortSignal
  ) => Promise<{ statusCode: grpc.status; statusMessage: string }> {
    return transport === 'grpc-web' ? this.dispatchGrpcWeb.bind(this) : this.dispatchConnect.bind(this)
  }

  /** One-shot HTTP-framed call (gRPC-Web or Connect; unary or server-stream —
   * see `dispatchGrpcWeb` / `dispatchConnect`). */
  private async runHttpFramedOneShot(resolved: ResolvedGrpcExecution): Promise<GRPCExecutionResult> {
    const { requestId } = resolved
    const messages: GrpcMessage[] = []
    const onSent = (data: string): void => {
      const sent: GrpcMessage = { direction: 'sent', data, timestamp: new Date().toISOString() }
      messages.push(sent)
      this.broadcastMessage(requestId, sent)
    }
    const onFrame = (payload: object): void => {
      const recv: GrpcMessage = { direction: 'received', data: stringifyMessage(payload), timestamp: new Date().toISOString() }
      messages.push(recv)
      this.broadcastMessage(requestId, recv)
    }
    const controller = new AbortController()
    this.activeRequests.set(requestId, () => { controller.abort() })

    let status: { statusCode: grpc.status; statusMessage: string }
    try {
      status = await this.httpFramedDispatch(resolved.transport)(resolved, { onSent, onFrame }, controller.signal)
    } catch (err) {
      this.activeRequests.delete(requestId)
      this.broadcastProgress(requestId, 'error')
      const result: GRPCExecutionResult = {
        ...this.resultBase(resolved),
        success: false,
        connected: messages.length > 0,
        messages,
        error: (err as Error).message,
        timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
      }
      this.persistHistory(requestId, result)
      return result
    }

    this.activeRequests.delete(requestId)
    const success = status.statusCode === grpc.status.OK
    const received = messages.filter((m) => m.direction === 'received')
    const result: GRPCExecutionResult = {
      ...this.resultBase(resolved),
      success,
      connected: true,
      statusCode: status.statusCode,
      statusMessage: status.statusMessage,
      ...(received.length > 0 ? { responseMessage: received[received.length - 1]?.data } : {}),
      messages,
      ...(success ? {} : { error: status.statusMessage }),
      timings: { startedAt: resolved.startedAt, durationMs: Date.now() - resolved.startTime }
    }
    this.broadcastProgress(requestId, success ? 'completed' : 'error')
    this.persistHistory(requestId, result)
    return result
  }

  /**
   * Open a long-lived streaming call for the scenario engine + the panel's
   * Connect button, streaming its lifecycle through callbacks: `onConnect` once
   * the call is open, `onMessage(undefined, payload)` for every received frame
   * (gRPC has no event names — always `undefined`, like a raw WebSocket), and
   * `onClose(error?)` once it ends. Registers the call in the active map (so
   * `send` / `disconnect` / the UI badge beam work) and returns a handle.
   *
   * `send(channel, payload)` writes a request message (client/bidi; the channel
   * is ignored). `close()` half-closes the client side (client/bidi) or cancels
   * (server-stream). For server-stream the configured request message is sent
   * automatically on open.
   */
  connectStreaming(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, connected: false, startTime: 0, startedAt: '', url: '', method: '' }
    const frames: GrpcMessage[] = []
    let fired = false
    let statusCode = grpc.status.OK
    let activeClient: grpc.Client | undefined
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      closeClient(activeClient)
      if (ctl.startTime > 0) {
        this.persistHistory(requestId, {
          requestId,
          success: ctl.connected && error === undefined,
          connected: ctl.connected,
          statusCode,
          statusMessage: grpcStatusName(statusCode),
          messages: frames,
          ...(error !== undefined ? { error } : {}),
          requestUrl: ctl.url,
          requestMethod: ctl.method,
          timings: { startedAt: ctl.startedAt, durationMs: Date.now() - ctl.startTime }
        })
      }
      input.onClose(error)
    }

    void (async () => {
      let resolved: ResolvedGrpcExecution
      try {
        resolved = await this.resolveExecution(requestId, input.timeout ?? DEFAULT_WS_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (ctl.closedByCaller) { fireClose(); return }
      ctl.startTime = resolved.startTime
      ctl.startedAt = resolved.startedAt
      ctl.url = resolved.address
      ctl.method = `${resolved.service}/${resolved.method}`

      const recordSent = (data: string): void => {
        const sent: GrpcMessage = { direction: 'sent', data, timestamp: new Date().toISOString() }
        frames.push(sent)
        this.broadcastMessage(requestId, sent)
      }
      const recordReceived = (response: object): void => {
        const recv: GrpcMessage = { direction: 'received', data: stringifyMessage(response), timestamp: new Date().toISOString() }
        frames.push(recv)
        this.broadcastMessage(requestId, recv)
        input.onMessage(undefined, response)
      }

      if (resolved.transport !== 'grpc') {
        // gRPC-Web / Connect: only server-stream can carry over HTTP/1.1
        // (`dispatchGrpcWeb`/`dispatchConnect` throw for client/bidi — the
        // panel UI already disables the Connect button for those, but a
        // scenario graph bound to `grpcConnect` could still ask for one).
        // Reuses the same dispatch helpers the one-shot `execute()` path
        // calls, forwarding each frame live via `recordReceived` instead of
        // batching, and tracks the call in `activeHttpFramedCalls` (not
        // `activeCalls`, which is shaped around a native grpc-js stream) so
        // `send` (no-op) / `disconnect` (abort) / the UI badge beam work.
        const controller = new AbortController()
        this.activeHttpFramedCalls.set(requestId, { controller, open: true, messages: frames })
        this.broadcastProgress(requestId, 'started')
        ctl.connected = true
        input.onConnect()
        try {
          const status = await this.httpFramedDispatch(resolved.transport)(resolved, { onSent: recordSent, onFrame: recordReceived }, controller.signal)
          statusCode = status.statusCode
          this.activeHttpFramedCalls.delete(requestId)
          this.broadcastProgress(requestId, statusCode === grpc.status.OK ? 'completed' : 'error')
          fireClose(statusCode === grpc.status.OK ? undefined : status.statusMessage)
        } catch (err) {
          this.activeHttpFramedCalls.delete(requestId)
          this.broadcastProgress(requestId, 'error')
          fireClose((err as Error).message)
        }
        return
      }

      let client: ReturnType<typeof resolveGrpcMethod>['client']
      let reconciledCallType = resolved.callType
      try {
        const resolvedMethod = resolveGrpcMethod(resolved.protoSource, resolved.address, resolved.service, resolved.method, this.credentials(resolved.secure))
        client = resolvedMethod.client
        // Trust the proto's streaming flags over the request's (possibly stale)
        // callType, so a unary method never gets dispatched down a stream path.
        reconciledCallType = reconcileCallType(resolved.callType, resolvedMethod.requestStream, resolvedMethod.responseStream)
        activeClient = client
      } catch (err) {
        this.broadcastProgress(requestId, 'error')
        fireClose((err as Error).message)
        return
      }

      const onErr = (err: grpc.ServiceError): void => {
        statusCode = err.code
        this.activeCalls.delete(requestId)
        this.broadcastProgress(requestId, 'error')
        fireClose(err.details || err.message)
      }
      const onEnd = (): void => {
        this.activeCalls.delete(requestId)
        this.broadcastProgress(requestId, 'completed')
        fireClose()
      }

      const { method, metadata } = resolved
      const callType = reconciledCallType
      let stream: ActiveCall['stream']
      if (callType === 'server-stream') {
        let reqObj: object
        try {
          reqObj = parseMessage(resolved.resolvedMessage)
        } catch (err) {
          this.broadcastProgress(requestId, 'error')
          fireClose((err as Error).message)
          return
        }
        // Record the request message sent at open so the chat + history show the
        // outgoing frame (server-stream sends exactly one request on connect).
        recordSent(resolved.resolvedMessage)
        stream = client[method](reqObj, metadata) as ClientReadableStream<object>
        ;(stream).on('data', recordReceived)
        ;(stream).on('error', onErr)
        ;(stream).on('end', onEnd)
      } else if (callType === 'client-stream') {
        stream = client[method](metadata, (err: grpc.ServiceError | null, response: object) => {
          if (err) { onErr(err); return }
          recordReceived(response)
          onEnd()
        }) as ClientWritableStream<object>
      } else {
        // bidi (and unary used as a streaming connect: fall through to duplex would
        // be wrong — unary connect isn't a thing, the engine binds streaming only).
        stream = client[method](metadata) as ClientDuplexStream<object, object>
        ;(stream as ClientDuplexStream<object, object>).on('data', recordReceived)
        ;(stream as ClientDuplexStream<object, object>).on('error', onErr)
        ;(stream as ClientDuplexStream<object, object>).on('end', onEnd)
      }

      const call: ActiveCall = { requestId, callType, stream, open: true, messages: frames }
      this.activeCalls.set(requestId, call)
      this.broadcastProgress(requestId, 'started')
      ctl.connected = true
      logger.info('[GRPCExecutionService] Streaming call open', { requestId, callType })
      input.onConnect()
    })()

    return {
      send: (_channel, payload) => this.send(requestId, payload),
      close: () => { ctl.closedByCaller = true; this.disconnect(requestId) },
      isOpen: () => this.isActive(requestId)
    }
  }

  /**
   * Write a request message on an active streaming call (client-stream / bidi).
   * Server-stream has no client writes, so this is a no-op (returns false).
   */
  send(requestId: string, message: string): boolean {
    // The HTTP-framed transports never accept a client write (server-stream
    // only): a no-op, same as native server-stream below.
    if (this.activeHttpFramedCalls.has(requestId)) return false
    const call = this.activeCalls.get(requestId)
    if (!call?.open) return false
    if (call.callType === 'server-stream') return false
    let payload: object
    try {
      payload = parseMessage(message)
    } catch (err) {
      logger.warn('[GRPCExecutionService] dropping unparseable streamed message', {
        requestId,
        error: (err as Error).message
      })
      return false
    }
    try {
      ;(call.stream as ClientWritableStream<object> | ClientDuplexStream<object, object>).write(payload)
    } catch {
      return false
    }
    const sent: GrpcMessage = { direction: 'sent', data: message, timestamp: new Date().toISOString() }
    call.messages.push(sent)
    this.broadcastMessage(requestId, sent)
    return true
  }

  /**
   * End an active streaming call. For client/bidi this half-closes the client
   * side (`end()`), letting the server's final response/frames arrive; for
   * server-stream it cancels. The `end`/`error` listener fires `onClose`.
   */
  disconnect(requestId: string): boolean {
    const httpFramedCall = this.activeHttpFramedCalls.get(requestId)
    if (httpFramedCall) {
      logger.info('[GRPCExecutionService] Closing HTTP-framed streaming call', { requestId })
      httpFramedCall.controller.abort()
      return true
    }
    const call = this.activeCalls.get(requestId)
    if (!call) return false
    logger.info('[GRPCExecutionService] Closing streaming call', { requestId, callType: call.callType })
    try {
      if (call.callType === 'server-stream') {
        ;(call.stream as ClientReadableStream<object>).cancel()
      } else {
        ;(call.stream as ClientWritableStream<object> | ClientDuplexStream<object, object>).end()
      }
    } catch {
      // best-effort
    }
    return true
  }

  /** Cancel an active request (one-shot unary/streaming) or a live streaming call. */
  cancel(requestId: string): boolean {
    const cancelUnary = this.activeRequests.get(requestId)
    if (cancelUnary) {
      logger.info('[GRPCExecutionService] Cancelling request', { requestId })
      this.broadcastProgress(requestId, 'cancelled')
      cancelUnary()
      this.activeRequests.delete(requestId)
      return true
    }
    const call = this.activeCalls.get(requestId)
    if (call) {
      this.broadcastProgress(requestId, 'cancelled')
      try {
        if (call.callType === 'server-stream') {
          ;(call.stream as ClientReadableStream<object>).cancel()
        } else {
          ;(call.stream as ClientDuplexStream<object, object>).cancel()
        }
      } catch {
        // best-effort
      }
      return true
    }
    const httpFramedCall = this.activeHttpFramedCalls.get(requestId)
    if (httpFramedCall) {
      this.broadcastProgress(requestId, 'cancelled')
      httpFramedCall.controller.abort()
      return true
    }
    return false
  }

  /** Whether a streaming call (or one-shot request) is currently active. */
  isActive(requestId: string): boolean {
    const call = this.activeCalls.get(requestId)
    if (call) return call.open
    const httpFramedCall = this.activeHttpFramedCalls.get(requestId)
    if (httpFramedCall) return httpFramedCall.open
    return this.activeRequests.has(requestId)
  }

  /**
   * Snapshot the frame buffer for an active streaming call (MCP `read_stream`).
   * Returns the slice from `afterIndex` + the current total, or null when the
   * call is no longer tracked.
   */
  getMessages(requestId: string, afterIndex = 0): { frames: GrpcMessage[]; total: number } | null {
    const call = this.activeCalls.get(requestId) ?? this.activeHttpFramedCalls.get(requestId)
    if (!call) return null
    const total = call.messages.length
    const start = Math.max(0, Math.min(afterIndex, total))
    return { frames: call.messages.slice(start), total }
  }

  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('grpc:request-progress', { requestId, status })
    }
  }

  private broadcastMessage(requestId: string, message: GrpcMessage): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('grpc:message', { requestId, message })
    }
  }

  /**
   * Persist a finished call to the response history (fire-and-forget) so the
   * response panel + a scenario `grpcConnect` node's preview can read the
   * frames later. Failures are swallowed — history is best-effort.
   */
  private persistHistory(requestId: string, result: GRPCExecutionResult): void {
    void responseHistoryService.storeExecutionResult(requestId, 'grpc', result).catch(() => {
      // best-effort; a history write must never surface as a call error
    })
  }
}

/** Singleton instance */
export const grpcExecutionService = new GRPCExecutionService()
