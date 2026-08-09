/**
 * gRPC Mock Server Service
 *
 * Makes restorm ACT AS a local gRPC server: it loads a `.proto`, exposes its
 * services/methods on a local HTTP/2 port via an `@grpc/grpc-js` `Server`, and
 * answers each configured method with a canned message, a scripted (code-node)
 * responder, and/or a non-OK gRPC status. All four call types are served —
 * unary, server-stream, client-stream, bidi.
 *
 * Unlike the SOAP/GraphQL/OData mocks (which ride the shared HTTP/1.1 `PortHost`
 * in `WebSocketExecutionService`), gRPC is HTTP/2 + protobuf and needs its OWN
 * server stack — so this owns its `grpc.Server` + port lifecycle, closer in
 * shape to the MQTT broker than to the HTTP-family mocks. Each hosted request
 * binds exactly one `grpc.Server` on its port; `closeAll()` tears every server
 * down on file close + app quit so no port leaks.
 *
 * Two entry points mirror the HTTP mock (`HTTPExecutionService`):
 *  - `listen()` / `stopListening()` — the request-panel Listen↔Stop toggle.
 *  - `connectStreamingGrpcServer()` — a long-lived bridge for the scenario
 *    `grpcListen` node (re-emits each served call on the node's `served` port).
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import * as grpc from '@grpc/grpc-js'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { collectionStore } from './CollectionStore'
import {
  loadGrpcPackage,
  enumerateGrpcServices,
  grpcStatusName,
  assertValidProtoPath,
  GRPCBIN_PROTO,
  type ProtoSource,
  type GrpcServiceDefinitionEntry
} from './grpc/grpcProtoLoader'
import { isGrpcRequest } from '../../shared/types/collections'
import type { GrpcMockMethod, GrpcRequest } from '../../shared/types/requests/GrpcRequest'

/** How long a scripted responder may run before it is aborted (ms). */
const SCRIPT_TIMEOUT_MS = 5000

/** Grace window for a graceful shutdown to drain in-flight calls before the
 * server is force-stopped (ms). */
const SHUTDOWN_GRACE_MS = 2000

/** Default port a freshly-created gRPC mock server binds (gRPC convention). */
export const DEFAULT_GRPC_SERVER_PORT = 50051

/** One served gRPC call surfaced on a scenario `grpcListen` node's `served`
 * output (shape mirrors the streaming `{ request, response }` envelope a
 * grpcConnect node emits, so a JSON-path picker drills it the same way). */
interface ServedSummary {
  request: { service: string; method: string; message: unknown; metadata: Record<string, string> }
  response: { statusCode: number; statusMessage: string; message: unknown }
}

/** A live hosted gRPC server (one per listening request). */
interface ActiveServer {
  requestId: string
  server: grpc.Server
  port: number
  /** Re-emit each served call (scenario `grpcListen` node bridge); undefined for
   * the plain request-panel Listen path. */
  onServed?: (summary: ServedSummary) => void
  /** Fire once the server stops (Stop / closeAll). */
  onStopped?: (error?: string) => void
}

/** Resolve a mock-method's per-method config keyed by `service/method`. */
function methodKey(service: string, method: string): string {
  return `${service}/${method}`
}

/** Parse a stored canned message (a JSON string) into a wire object. An empty
 * string is the valid empty message `{}`; malformed JSON throws so the served
 * call fails with a clear INTERNAL status rather than silently sending `{}`. */
function parseCanned(raw: string | undefined): object {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return {}
  const parsed: unknown = JSON.parse(trimmed)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('canned response must be a JSON object')
  }
  return parsed
}

/** Parse a stored canned stream (a JSON array of frame objects) for a
 * server/bidi-streaming method. A bare object is treated as a single frame. */
function parseCannedFrames(raw: string | undefined): object[] {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return []
  const parsed: unknown = JSON.parse(trimmed)
  if (Array.isArray(parsed)) return parsed.filter((f): f is object => typeof f === 'object' && f !== null)
  if (typeof parsed === 'object' && parsed !== null) return [parsed]
  throw new Error('canned stream response must be a JSON array or object')
}

/** Flatten grpc `Metadata` to a plain string map for the served summary. */
function flattenMetadata(metadata: grpc.Metadata): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, values] of Object.entries(metadata.getMap())) {
    out[k] = Array.isArray(values) ? values.join(', ') : String(values)
  }
  return out
}

/** Build a gRPC `Metadata` from a mock method's configured trailers. */
function trailersToMetadata(trailers: GrpcMockMethod['trailers']): grpc.Metadata | undefined {
  if (!trailers || trailers.length === 0) return undefined
  const md = new grpc.Metadata()
  for (const t of trailers) {
    const key = typeof t.key === 'string' ? t.key : ''
    if (key === '' || t.enabled === false) continue
    const value = t.value as { toString?: () => string } | undefined
    md.set(key, value === undefined ? '' : String(value))
  }
  return md
}

class GRPCMockServerService {
  /** Hosted servers, keyed by requestId (one server per listening request). */
  private servers = new Map<string, ActiveServer>()
  /** Per-request served-call counter (drives the "served N" banner). */
  private servedCounts = new Map<string, number>()

  /**
   * SERVER MODE (Listen button): start hosting `requestId`'s gRPC mock. Loads
   * the request's proto, binds an `@grpc/grpc-js` server on `localhost:<port>`,
   * and answers every configured method until {@link stopListening}. Resolves
   * once the server is listening (or fails to bind).
   */
  async listen(requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> {
    if (this.servers.has(requestId)) {
      return { success: true, listening: true }
    }
    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)
    try {
      await this.bringUpServer(requestId, {
        onStopped: (error) => {
          this.servedCounts.delete(requestId)
          this.broadcastProgress(requestId, error ? 'error' : 'completed')
        }
      })
      return { success: true, listening: true }
    } catch (err) {
      this.servedCounts.delete(requestId)
      this.broadcastProgress(requestId, 'error')
      return { success: false, listening: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * SCENARIO server node ({@link grpcListen}): HOST this request's gRPC mock as
   * a LONG-LIVED listener and bridge it to the scheduler's connect machinery.
   * `connect` = listen, each served call re-emits via `onMessage` (→ the `served`
   * port), `close` = stop the server (→ the node's `done`). Stays up until
   * `close()` (a grpcClose node) or a Stop — exactly like the HTTP mock server.
   */
  connectStreamingGrpcServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      this.servedCounts.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      input.onClose(error)
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    void this.bringUpServer(requestId, {
      onServed: (summary) => { input.onMessage(undefined, summary) },
      onStopped: (error) => { fireClose(error) }
    })
      .then(() => { input.onConnect() })
      .catch((err: unknown) => { fireClose(err instanceof Error ? err.message : String(err)) })

    return {
      // A hosted gRPC mock never SENDS unprompted — it only answers inbound
      // calls — so `send` is a no-op (there is no grpcServerSend node).
      send: () => false,
      close: () => { this.stopListening(requestId) },
      isOpen: () => this.isListening(requestId)
    }
  }

  /** Stop hosting this request's gRPC mock (the Stop button / a grpcClose node).
   * Idempotent. */
  stopListening(requestId: string): boolean {
    const active = this.servers.get(requestId)
    if (!active) return false
    this.servers.delete(requestId)
    this.servedCounts.delete(requestId)
    // GRACEFUL shutdown, then signal stopped. A scenario `served`→grpcServerClose
    // fires the instant a call is served — while that call's reply is still being
    // flushed on the HTTP/2 stream. `tryShutdown` drains in-flight RPCs before it
    // completes, so the consumer receives its reply; we therefore defer BOTH the
    // `onStopped` signal (which closes the scenario node's scope → fires `done`)
    // AND the "stopped" log until tryShutdown's callback. Firing `onStopped`
    // synchronously here would close the scope while the consumer's call is still
    // in flight, the teardown would CANCEL it, and the consumer node would never
    // complete — the run then hangs (reproduced cold: served→stored→stop, then no
    // run end). A bounded force-fallback frees the port if a stream is genuinely
    // stuck, and still signals stopped so the run can never hang on a wedged
    // socket. `settled` makes the two paths mutually exclusive + idempotent.
    let settled = false
    const finishStop = (): void => {
      if (settled) return
      settled = true
      active.onStopped?.()
      logger.info('[GRPCMockServerService] mock server stopped', { requestId, port: active.port })
    }
    const fallback = setTimeout(() => {
      try { active.server.forceShutdown() } catch { /* already shut down */ }
      finishStop()
    }, SHUTDOWN_GRACE_MS)
    try {
      active.server.tryShutdown(() => { clearTimeout(fallback); finishStop() })
    } catch {
      clearTimeout(fallback)
      try { active.server.forceShutdown() } catch { /* already shut down */ }
      finishStop()
    }
    return true
  }

  /** Whether this request is currently hosting a gRPC mock server. */
  isListening(requestId: string): boolean {
    return this.servers.has(requestId)
  }

  /** Tear down EVERY hosted gRPC server (file close + app quit) so no port
   * leaks. Mirrors `WebSocketExecutionService.closeAll()`. */
  closeAll(): void {
    const count = this.servers.size
    for (const requestId of [...this.servers.keys()]) {
      try { this.stopListening(requestId) } catch { /* best-effort teardown */ }
    }
    if (count > 0) logger.info('[GRPCMockServerService] Closed all gRPC mock servers', { count })
  }

  /**
   * Load `requestId`'s proto, build the per-method handlers, bind a fresh
   * `grpc.Server` on its port (insecure or TLS), and register it as active.
   * Throws on a missing request, an unparseable proto, or a bind failure — the
   * caller maps that to a failed Listen / a node close-on-error.
   */
  private async bringUpServer(
    requestId: string,
    hooks: { onServed?: (s: ServedSummary) => void; onStopped?: (error?: string) => void }
  ): Promise<void> {
    const bound = collectionStore.findById(requestId)
    if (!bound || !isGrpcRequest(bound)) {
      throw new Error('gRPC mock server: the bound request is not a gRPC request')
    }
    const req = bound as unknown as GrpcRequest
    if (req.server !== true) {
      throw new Error('gRPC mock server: the bound request is not in server mode')
    }
    const port = this.parseServerPort(this.resolvedMockUrl(requestId, req.url))
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error('A valid localhost port is required for a gRPC mock server')
    }

    const protoSource: ProtoSource = {
      ...(req.protoContent ? { protoContent: req.protoContent } : {}),
      ...(req.protoPath ? { protoPath: req.protoPath } : {})
    }
    const root = loadGrpcPackage(protoSource)
    const services = enumerateGrpcServices(root)
    if (services.length === 0) {
      throw new Error('gRPC mock server: the proto declares no services')
    }

    const mockByKey = new Map<string, GrpcMockMethod>()
    for (const m of req.mockMethods ?? []) {
      mockByKey.set(methodKey(m.service, m.method), m)
    }

    const server = new grpc.Server()
    for (const svc of services) {
      server.addService(svc.definition, this.buildHandlers(requestId, svc, mockByKey, hooks))
    }

    // Server reflection (default on): a client can discover services/methods
    // without the `.proto`. Loaded lazily so a non-reflection mock never pulls
    // the dependency in.
    if (req.reflection !== false) {
      try {
        const { ReflectionService } = await import('@grpc/reflection')
        const protoLoader = await import('@grpc/proto-loader')
        const pkgDef = protoLoader.loadSync(this.materialiseProtoFile(protoSource), {
          keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
          includeDirs: []
        })
        new ReflectionService(pkgDef).addToServer(server)
      } catch (err) {
        // Reflection is best-effort: a server that can't serve reflection still
        // answers its methods. Log + carry on rather than failing the Listen.
        logger.warn('[GRPCMockServerService] server reflection unavailable', {
          requestId,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    const credentials = this.serverCredentials(req)
    await new Promise<void>((resolve, reject) => {
      server.bindAsync(`127.0.0.1:${port}`, credentials, (err, boundPort) => {
        if (err) { reject(err); return }
        logger.info('[GRPCMockServerService] mock server listening', { requestId, port: boundPort })
        resolve()
      })
    })

    this.servers.set(requestId, { requestId, server, port, ...hooks })
  }

  /** Resolve a {@link ProtoSource} to a `.proto` file PATH the reflection
   * service can load: a `protoPath` directly, inline `protoContent` written to a
   * temp file, or the bundled grpcbin descriptor written to a temp file. */
  private materialiseProtoFile(source: ProtoSource): string {
    if (source.protoPath && source.protoPath.trim() !== '') {
      return assertValidProtoPath(source.protoPath)
    }
    const content = source.protoContent && source.protoContent.trim() !== ''
      ? source.protoContent
      : GRPCBIN_PROTO
    const dir = mkdtempSync(join(tmpdir(), 'restorm-grpc-srv-'))
    const file = join(dir, 'mock.proto')
    writeFileSync(file, content, 'utf8')
    return file
  }

  /** Build the handler map for one service: one handler per method, dispatching
   * by the method's streaming shape and the configured mock response. */
  private buildHandlers(
    requestId: string,
    svc: GrpcServiceDefinitionEntry,
    mockByKey: Map<string, GrpcMockMethod>,
    hooks: { onServed?: (s: ServedSummary) => void }
  ): grpc.UntypedServiceImplementation {
    const handlers: grpc.UntypedServiceImplementation = {}
    for (const m of svc.methods) {
      const mock = mockByKey.get(methodKey(svc.name, m.name))
      if (m.requestStream && m.responseStream) {
        handlers[m.name] = this.bidiHandler(requestId, svc.name, m.name, mock, hooks)
      } else if (m.requestStream) {
        handlers[m.name] = this.clientStreamHandler(requestId, svc.name, m.name, mock, hooks)
      } else if (m.responseStream) {
        handlers[m.name] = this.serverStreamHandler(requestId, svc.name, m.name, mock, hooks)
      } else {
        handlers[m.name] = this.unaryHandler(requestId, svc.name, m.name, mock, hooks)
      }
    }
    return handlers
  }

  /** Compute the response object for a unary/client-stream call: a scripted
   * responder (wins) or the canned message. Throws on a parse/script failure. */
  private async computeResponse(mock: GrpcMockMethod | undefined, requestMessage: unknown): Promise<object> {
    if (mock?.script && mock.script.trim() !== '') {
      const { runCodeInSandbox } = await import('../scenarioEngine/codeSandbox')
      const { result } = await runCodeInSandbox({
        code: mock.script,
        input: { request: requestMessage },
        timeoutMs: SCRIPT_TIMEOUT_MS
      })
      if (typeof result !== 'object' || result === null) {
        throw new Error('scripted responder must return an object')
      }
      return result
    }
    return parseCanned(mock?.responseMessage)
  }

  /** Resolve the configured non-OK status for a method (undefined = OK). */
  private statusError(mock: GrpcMockMethod | undefined): grpc.ServerErrorResponse | undefined {
    // grpc.status.OK === 0; compare the literal to avoid the enum-vs-number rule.
    if (mock?.statusCode === undefined || mock.statusCode === 0) return undefined
    const err: grpc.ServerErrorResponse = {
      name: 'GrpcMockStatus',
      message: mock.statusMessage ?? grpcStatusName(mock.statusCode),
      code: mock.statusCode,
      details: mock.statusMessage ?? grpcStatusName(mock.statusCode)
    }
    const trailers = trailersToMetadata(mock.trailers)
    if (trailers) err.metadata = trailers
    return err
  }

  private unaryHandler(
    requestId: string,
    service: string,
    method: string,
    mock: GrpcMockMethod | undefined,
    hooks: { onServed?: (s: ServedSummary) => void }
  ): grpc.handleUnaryCall<object, object> {
    return (call, callback) => {
      const errored = this.statusError(mock)
      if (errored) {
        this.recordServed(requestId, service, method, call.request, call.metadata, errored.code ?? grpc.status.UNKNOWN, undefined, hooks)
        callback(errored, null)
        return
      }
      void this.computeResponse(mock, call.request)
        .then((response) => {
          // Send the reply FIRST so the unary call is in its completing state, THEN
          // record the served call. `recordServed` fires the scenario `served` port,
          // which a grpcServerClose wired to `served` uses to stop the server; that
          // stop is GRACEFUL (tryShutdown) and so drains this now-completing call
          // before closing the port — the client still receives the reply.
          callback(null, response)
          this.recordServed(requestId, service, method, call.request, call.metadata, grpc.status.OK, response, hooks)
        })
        .catch((err: unknown) => {
          callback(this.internalError(err), null)
        })
    }
  }

  private serverStreamHandler(
    requestId: string,
    service: string,
    method: string,
    mock: GrpcMockMethod | undefined,
    hooks: { onServed?: (s: ServedSummary) => void }
  ): grpc.handleServerStreamingCall<object, object> {
    return (call) => {
      const errored = this.statusError(mock)
      if (errored) {
        this.recordServed(requestId, service, method, call.request, call.metadata, errored.code ?? grpc.status.UNKNOWN, undefined, hooks)
        call.emit('error', errored)
        return
      }
      let frames: object[]
      try {
        frames = parseCannedFrames(mock?.responseMessage)
      } catch (err) {
        call.emit('error', this.internalError(err))
        return
      }
      for (const frame of frames) call.write(frame)
      this.recordServed(requestId, service, method, call.request, call.metadata, grpc.status.OK, frames, hooks)
      call.end()
    }
  }

  private clientStreamHandler(
    requestId: string,
    service: string,
    method: string,
    mock: GrpcMockMethod | undefined,
    hooks: { onServed?: (s: ServedSummary) => void }
  ): grpc.handleClientStreamingCall<object, object> {
    return (call, callback) => {
      const received: object[] = []
      call.on('data', (msg: object) => { received.push(msg) })
      call.on('end', () => {
        const errored = this.statusError(mock)
        if (errored) {
          this.recordServed(requestId, service, method, received, call.metadata, errored.code ?? grpc.status.UNKNOWN, undefined, hooks)
          callback(errored, null)
          return
        }
        void this.computeResponse(mock, received)
          .then((response) => {
            // Deliver before recording: `served` may trigger a grpcServerClose
            // (see the unary handler note).
            callback(null, response)
            this.recordServed(requestId, service, method, received, call.metadata, grpc.status.OK, response, hooks)
          })
          .catch((err: unknown) => { callback(this.internalError(err), null) })
      })
    }
  }

  private bidiHandler(
    requestId: string,
    service: string,
    method: string,
    mock: GrpcMockMethod | undefined,
    hooks: { onServed?: (s: ServedSummary) => void }
  ): grpc.handleBidiStreamingCall<object, object> {
    return (call) => {
      const errored = this.statusError(mock)
      let cannedFrames: object[] = []
      if (!errored) {
        try {
          cannedFrames = parseCannedFrames(mock?.responseMessage)
        } catch (err) {
          call.emit('error', this.internalError(err))
          return
        }
      }
      call.on('data', (msg: object) => {
        if (errored) return
        // Echo-or-canned: if canned frames are configured, write them per
        // received message; otherwise echo the received message straight back.
        if (cannedFrames.length > 0) {
          for (const frame of cannedFrames) call.write(frame)
        } else {
          call.write(msg)
        }
        this.recordServed(requestId, service, method, msg, call.metadata, grpc.status.OK, cannedFrames.length > 0 ? cannedFrames : msg, hooks)
      })
      call.on('end', () => {
        if (errored) {
          this.recordServed(requestId, service, method, undefined, call.metadata, errored.code ?? grpc.status.UNKNOWN, undefined, hooks)
          call.emit('error', errored)
          return
        }
        call.end()
      })
    }
  }

  /** Wrap a script/parse failure as a gRPC INTERNAL status error. */
  private internalError(err: unknown): grpc.ServerErrorResponse {
    const message = err instanceof Error ? err.message : String(err)
    return { name: 'GrpcMockInternal', message, code: grpc.status.INTERNAL, details: message }
  }

  /** Record one served call: bump the count, broadcast it, and re-emit the
   * served summary on the scenario node's `served` port (if bridged). */
  private recordServed(
    requestId: string,
    service: string,
    method: string,
    requestMessage: unknown,
    metadata: grpc.Metadata,
    statusCode: number,
    responseMessage: unknown,
    hooks: { onServed?: (s: ServedSummary) => void }
  ): void {
    const served = (this.servedCounts.get(requestId) ?? 0) + 1
    this.servedCounts.set(requestId, served)
    this.broadcastServed(requestId, served)
    const summary: ServedSummary = {
      request: { service, method, message: requestMessage, metadata: flattenMetadata(metadata) },
      response: { statusCode, statusMessage: grpcStatusName(statusCode), message: responseMessage }
    }
    hooks.onServed?.(summary)
    logger.info('[GRPCMockServerService] mock served', { requestId, method: `${service}/${method}`, statusCode, served })
  }

  /** Build server credentials: insecure by default, or TLS with the configured
   * PEM cert + key when `tls` is on. */
  private serverCredentials(req: GrpcRequest): grpc.ServerCredentials {
    if (req.tls === true && req.tlsCertPem && req.tlsKeyPem) {
      return grpc.ServerCredentials.createSsl(
        null,
        [{ private_key: Buffer.from(req.tlsKeyPem), cert_chain: Buffer.from(req.tlsCertPem) }],
        false
      )
    }
    return grpc.ServerCredentials.createInsecure()
  }

  /** The mock address with its Handlebars expressions substituted — port and
   * path are expression fields like a client URL. Falls back to the raw url
   * when no resolution exists, so a plain literal keeps working unchanged. */
  private resolvedMockUrl(requestId: string, rawUrl: string): string {
    const resolved = contextService.resolveUrlForRequest(requestId)?.resolvedUrl
    return resolved && resolved.trim().length > 0 ? resolved : rawUrl
  }

  /** Split a mock address (`localhost:<port>`, optional scheme/path) into its
   * numeric port. The host is fixed to localhost; a path/query is ignored. */
  private parseServerPort(raw: string): number {
    const stripped = raw.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const authority = slash >= 0 ? stripped.slice(0, slash) : stripped
    const colon = authority.lastIndexOf(':')
    return colon >= 0 ? Number.parseInt(authority.slice(colon + 1), 10) : NaN
  }

  /** Broadcast the gRPC mock's served-call count to the renderer (the request
   * panel shows "served N requests" while listening). */
  private broadcastServed(requestId: string, count: number): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('grpc:server-served', { requestId, count })
    }
  }

  /** Broadcast the server's listening lifecycle on a DISTINCT channel from the
   * client streaming progress (`grpc:request-progress`), so a hosting server's
   * beam never collides with a client call's beam on the same request id. */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('grpc:server-progress', { requestId, status })
    }
  }
}

/** Singleton instance */
export const grpcMockServerService = new GRPCMockServerService()
