/**
 * Connect-RPC HTTP transport. Unary calls are the simplest of the three
 * transports this app speaks: a plain, unenveloped JSON body in, a plain
 * JSON body (or JSON error) back — no framing at all. Server-streaming calls
 * use the enveloped `application/connect+json` streaming protocol (see
 * `connectCodec.ts`): one enveloped request message, a stream of enveloped
 * DATA responses, and a final END-STREAM envelope carrying the status.
 *
 * Plain `node:http`/`node:https`, same rationale as `grpcWebTransport.ts`:
 * there's no `HttpRequest`-shaped primitive to hand `HTTPExecutionService`.
 * `splitHostPort`/`flattenHeaders` are shared with that module rather than
 * duplicated — both transports address the same `host:port` a native gRPC
 * client would.
 */

import http from 'node:http'
import https from 'node:https'
import * as grpc from '@grpc/grpc-js'
import { splitHostPort } from './grpcWebTransport'
import { encodeConnectEnvelope, decodeConnectEnvelopes, parseConnectEndStream } from './connectCodec'

/** Connect's string error codes map 1:1 onto the numeric gRPC status codes
 * (same vocabulary, different wire encoding) — this table lets the response
 * panel reuse the exact same status display as native gRPC / gRPC-Web. */
const CONNECT_CODE_TO_GRPC_STATUS: Record<string, number> = {
  canceled: 1,
  unknown: 2,
  invalid_argument: 3,
  deadline_exceeded: 4,
  not_found: 5,
  already_exists: 6,
  permission_denied: 7,
  resource_exhausted: 8,
  failed_precondition: 9,
  aborted: 10,
  out_of_range: 11,
  unimplemented: 12,
  internal: 13,
  unavailable: 14,
  data_loss: 15,
  unauthenticated: 16
}

export interface ConnectError {
  code: string
  message: string
}

interface ConnectRequestOptions {
  /** `host:port`, scheme already stripped (mirrors `normalizeAddress`). */
  address: string
  secure: boolean
  /** The gRPC path, e.g. `/package.Service/Method` — Connect addresses the
   * same route a native/gRPC-Web call would. */
  path: string
  /** Metadata as plain HTTP headers (Connect maps custom metadata directly,
   * same convention as gRPC-Web). */
  headers: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
}

export interface ConnectUnaryOptions extends ConnectRequestOptions {
  /** The already-resolved JSON request message, as text (unary sends it
   * unenveloped, verbatim). */
  body: string
}

export interface ConnectUnaryResult {
  ok: boolean
  /** Parsed JSON message on success. */
  message?: unknown
  /** Parsed error on failure. */
  error?: ConnectError
}

/** Attach the shared timeout/abort/error wiring a `node:http`/`https` request
 * needs regardless of unary vs. streaming — every call site below repeats the
 * same three listeners otherwise. */
function armRequest(req: http.ClientRequest, timeoutMs: number, signal: AbortSignal | undefined, finish: (fn: () => void) => void, reject: (err: Error) => void): void {
  req.on('error', (err) => { finish(() => { reject(err) }) })
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error(`Connect request timed out after ${timeoutMs}ms`))
  })
  if (signal) {
    signal.addEventListener('abort', () => { req.destroy(new Error('aborted')) }, { once: true })
  }
}

/**
 * Execute one Connect unary call: POST the unenveloped JSON body, read the
 * whole response, and unwrap it per the Connect unary protocol — a 2xx
 * response body IS the response message; any other status carries a JSON
 * `{ code, message }` error instead.
 */
export function executeConnectUnary(options: ConnectUnaryOptions): Promise<ConnectUnaryResult> {
  const { address, secure, path, headers, body, timeoutMs, signal } = options
  const { hostname, port } = splitHostPort(address)
  const client = secure ? https : http
  const bodyBuffer = Buffer.from(body, 'utf8')

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    const req = client.request(
      {
        hostname,
        port: port ? Number(port) : secure ? 443 : 80,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'connect-protocol-version': '1',
          'content-length': String(bodyBuffer.length)
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', () => {
          finish(() => {
            const raw = Buffer.concat(chunks).toString('utf8')
            const statusOk = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300
            let parsed: unknown
            try {
              parsed = raw.length > 0 ? JSON.parse(raw) : {}
            } catch {
              parsed = undefined
            }
            if (statusOk) {
              resolve({ ok: true, message: parsed ?? {} })
              return
            }
            const err = parsed as Partial<ConnectError> | undefined
            resolve({
              ok: false,
              error: {
                code: err?.code ?? 'unknown',
                message: err?.message ?? res.statusMessage ?? `HTTP ${res.statusCode}`
              }
            })
          })
        })
        res.on('error', (err) => { finish(() => { reject(err) }) })
      }
    )

    armRequest(req, timeoutMs, signal, finish, reject)
    req.end(bodyBuffer)
  })
}

export interface ConnectStreamOptions extends ConnectRequestOptions {
  /** The single request message (server-stream sends exactly one, like
   * gRPC-Web/native — client/bidi aren't dispatched through this transport). */
  body: string
  /** Called once per decoded DATA envelope, as it arrives (chunked streaming). */
  onMessage: (payload: unknown) => void
}

export interface ConnectStreamResult {
  error?: ConnectError
}

/**
 * Execute one Connect server-streaming call: POST a single enveloped request
 * message, decode each DATA envelope of the response as it streams in (via
 * `onMessage`), and resolve once the END-STREAM envelope (or the HTTP
 * response) ends, surfacing any error it carried.
 */
export function executeConnectStream(options: ConnectStreamOptions): Promise<ConnectStreamResult> {
  const { address, secure, path, headers, body, timeoutMs, signal, onMessage } = options
  const { hostname, port } = splitHostPort(address)
  const client = secure ? https : http
  const requestEnvelope = encodeConnectEnvelope(Buffer.from(body, 'utf8'))

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }

    const req = client.request(
      {
        hostname,
        port: port ? Number(port) : secure ? 443 : 80,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/connect+json',
          'connect-protocol-version': '1',
          'content-length': String(requestEnvelope.length)
        }
      },
      (res) => {
        let buffered = Buffer.alloc(0)
        let endStreamResult: ConnectStreamResult = {}

        res.on('data', (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk])
          const decoded = decodeConnectEnvelopes(buffered)
          buffered = decoded.remainder
          for (const envelope of decoded.envelopes) {
            if (envelope.endStream) {
              endStreamResult = parseConnectEndStream(envelope.payload)
              continue
            }
            // A malformed DATA envelope is dropped rather than aborting the
            // whole stream — the other frames + the eventual end-stream
            // status are still worth surfacing.
            try {
              onMessage(JSON.parse(envelope.payload.toString('utf8')))
            } catch {
              // dropped
            }
          }
        })
        res.on('end', () => { finish(() => { resolve(endStreamResult) }) })
        res.on('error', (err) => { finish(() => { reject(err) }) })
      }
    )

    armRequest(req, timeoutMs, signal, finish, reject)
    req.end(requestEnvelope)
  })
}

/** Resolve a gRPC-shaped status from a Connect error (or its absence),
 * mirroring `grpcWebStatus`'s contract so the caller doesn't need to know
 * which HTTP-framed transport produced the result. */
export function connectStatusFromError(error?: ConnectError): { statusCode: grpc.status; statusMessage: string } {
  if (!error) return { statusCode: grpc.status.OK, statusMessage: grpc.status[grpc.status.OK] }
  const statusCode = CONNECT_CODE_TO_GRPC_STATUS[error.code] ?? grpc.status.UNKNOWN
  return { statusCode, statusMessage: error.message || (grpc.status[statusCode] ?? `CODE_${statusCode}`) }
}
