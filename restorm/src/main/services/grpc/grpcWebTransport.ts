/**
 * gRPC-Web HTTP transport: POSTs a single framed request (see
 * `grpcWebCodec.ts`) to the gRPC-Web endpoint — the same `/package.Service/Method`
 * path native gRPC dispatches to — and streams the framed response back
 * frame-by-frame via `onData`, so a server-streaming call surfaces each
 * message as it arrives, exactly like the native `connectStreaming` path.
 *
 * Plain `node:http`/`node:https` rather than `HTTPExecutionService`: that
 * service is built around the `HttpRequest` model (URL/headers/body-type
 * shaping, redirects, cookies) a `GrpcRequest` doesn't have, so there's no
 * public primitive to call into — this mirrors its low-level approach
 * instead (see `HTTPExecutionService.dispatchOnce`).
 */

import http from 'node:http'
import https from 'node:https'
import * as grpc from '@grpc/grpc-js'
import { decodeGrpcWebFrames, parseGrpcWebTrailers } from './grpcWebCodec'

export interface GrpcWebRequestOptions {
  /** `host:port`, scheme already stripped (mirrors `normalizeAddress`). */
  address: string
  secure: boolean
  /** The gRPC path, e.g. `/package.Service/Method`. */
  path: string
  /** Metadata as plain HTTP headers (gRPC-Web maps custom metadata directly). */
  headers: Record<string, string>
  /** The already-framed request body (one `encodeGrpcWebFrame` envelope). */
  body: Buffer
  timeoutMs: number
  /** Called once per DATA frame's payload, as it arrives (chunked streaming). */
  onData: (payload: Buffer) => void
  signal?: AbortSignal
}

export interface GrpcWebResponse {
  httpStatus: number
  httpStatusMessage: string
  /** Response headers (lower-cased keys), for a `grpc-status` that arrived as
   * a real HTTP header instead of a trailer frame (e.g. an error before any
   * data was written). */
  headers: Record<string, string>
  /** Trailers parsed from the TRAILERS frame (merged over any same-named
   * response header, since the frame is the authoritative source). */
  trailers: Record<string, string>
}

/** Split `host:port` into its parts, tolerating a bracketed IPv6 host. Shared
 * with `connectTransport.ts` — both HTTP-framed transports address the same
 * `host:port` a native gRPC client would. */
export function splitHostPort(address: string): { hostname: string; port: string | undefined } {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(address)
  if (bracketed) return { hostname: bracketed[1] ?? address, port: bracketed[2] }
  const idx = address.lastIndexOf(':')
  if (idx === -1) return { hostname: address, port: undefined }
  return { hostname: address.slice(0, idx), port: address.slice(idx + 1) }
}

/** Flatten a Node response header map (values may be `string | string[]`) into
 * a lower-cased single-string map — gRPC status/message headers are scalar.
 * Shared with `connectTransport.ts` (see `splitHostPort`). */
export function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    out[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? '') : value
  }
  return out
}

/**
 * Execute one gRPC-Web HTTP call. Resolves once the response ends (or the
 * connection errors/times out) with the HTTP status + parsed trailers;
 * DATA frame payloads are delivered incrementally via `onData` as the body
 * streams in, so a server-streaming caller doesn't have to wait for `end`.
 */
export function executeGrpcWebRequest(options: GrpcWebRequestOptions): Promise<GrpcWebResponse> {
  const { address, secure, path, headers, body, timeoutMs, onData, signal } = options
  const { hostname, port } = splitHostPort(address)
  const client = secure ? https : http

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
          'content-type': 'application/grpc-web+proto',
          'x-grpc-web': '1',
          'content-length': String(body.length)
        }
      },
      (res) => {
        const responseHeaders = flattenHeaders(res.headers)
        let buffered = Buffer.alloc(0)
        let trailers: Record<string, string> = {}

        res.on('data', (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk])
          const decoded = decodeGrpcWebFrames(buffered)
          buffered = decoded.remainder
          for (const frame of decoded.frames) {
            if (frame.trailer) trailers = { ...trailers, ...parseGrpcWebTrailers(frame.payload) }
            else onData(frame.payload)
          }
        })
        res.on('end', () => {
          finish(() => {
            resolve({
              httpStatus: res.statusCode ?? 0,
              httpStatusMessage: res.statusMessage ?? '',
              headers: responseHeaders,
              trailers
            })
          })
        })
        res.on('error', (err) => { finish(() => { reject(err) }) })
      }
    )

    req.on('error', (err) => { finish(() => { reject(err) }) })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`gRPC-Web request timed out after ${timeoutMs}ms`))
    })
    if (signal) {
      signal.addEventListener('abort', () => { req.destroy(new Error('aborted')) }, { once: true })
    }
    req.end(body)
  })
}

/**
 * The gRPC wire spec percent-encodes non-ASCII / control characters in
 * `grpc-message` (a restricted form of URI encoding). `decodeURIComponent`
 * covers the common case; fall back to the raw string on a malformed escape
 * rather than throwing away an otherwise-readable error message.
 */
function decodeGrpcMessage(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Resolve the gRPC status from a gRPC-Web response: the TRAILERS frame is
 * authoritative when present; a call that fails before any frame is written
 * (e.g. "method not found") often carries `grpc-status` as a plain HTTP
 * response header instead. Absent either, fall back to the HTTP status.
 */
export function grpcWebStatus(response: GrpcWebResponse): { statusCode: grpc.status; statusMessage: string } {
  const rawStatus = response.trailers['grpc-status'] ?? response.headers['grpc-status']
  if (rawStatus !== undefined) {
    const parsed = Number(rawStatus)
    const statusCode = Number.isFinite(parsed) ? parsed : grpc.status.UNKNOWN
    const rawMessage = response.trailers['grpc-message'] ?? response.headers['grpc-message']
    return {
      statusCode,
      statusMessage: rawMessage ? decodeGrpcMessage(rawMessage) : (grpc.status[statusCode] ?? `CODE_${statusCode}`)
    }
  }
  if (response.httpStatus >= 200 && response.httpStatus < 300) {
    return { statusCode: grpc.status.OK, statusMessage: grpc.status[grpc.status.OK] }
  }
  return {
    statusCode: grpc.status.UNKNOWN,
    statusMessage: response.httpStatusMessage || `HTTP ${response.httpStatus}`
  }
}
