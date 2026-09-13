/**
 * Protocol classification of a captured HTTP exchange, and the extraction
 * of the protocol-specific discriminants the route deduction routes on:
 * the GraphQL operation, the gRPC-web service/method, the WebSocket
 * message type.
 *
 * Pure. The capture engine calls this once the response is known; the
 * WebSocket helper runs per frame.
 */

import type { RecordingProtocol } from '../types/recordingSession'
import type { CaptureHeader } from '../types/recordingCapture'

export interface ClassificationInput {
  method: string
  url: string
  requestHeaders: readonly CaptureHeader[]
  /** Decoded request body text, when textual. */
  requestBodyText: string | null
  responseMimeType: string | null
  responseHeaders: readonly CaptureHeader[]
}

export interface Classification {
  protocol: Exclude<RecordingProtocol, 'websocket'>
  graphql?: { operationType: 'query' | 'mutation' | 'subscription'; operationName: string | null }
  grpc?: { service: string; method: string }
}

export function headerValue(headers: readonly CaptureHeader[], name: string): string | null {
  const lower = name.toLowerCase()
  const found = headers.find((h) => h.key.toLowerCase() === lower)
  return found?.value ?? null
}

function isGrpcWebContentType(value: string | null): boolean {
  // `application/grpc-web`, `application/grpc-web+proto`, `application/grpc-web-text`, `application/grpc`.
  return value?.toLowerCase().startsWith('application/grpc') ?? false
}

function isGraphqlContentType(value: string | null): boolean {
  return value?.toLowerCase().startsWith('application/graphql') ?? false
}

/** `/pkg.Service/Method` → the last two path segments. */
export function grpcRouteOf(url: string): { service: string; method: string } | null {
  try {
    const segments = new URL(url).pathname.split('/').filter((s) => s !== '')
    if (segments.length < 2) return null
    const method = segments[segments.length - 1]
    const service = segments[segments.length - 2]
    if (method === undefined || service === undefined) return null
    return { service, method }
  } catch {
    return null
  }
}

const OPERATION_RE = /^\s*(?:#[^\n]*\n\s*)*(query|mutation|subscription)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/
const SHORTHAND_QUERY_RE = /^\s*(?:#[^\n]*\n\s*)*\{/

/** Parse a GraphQL document's first operation. Anonymous shorthand `{ … }`
 * is a query. Returns `null` when the text is not a GraphQL document. */
export function graphqlOperationOf(document: string, operationName?: string | null): Classification['graphql'] | null {
  const match = OPERATION_RE.exec(document)
  if (match) {
    const operationType = match[1] as 'query' | 'mutation' | 'subscription'
    return { operationType, operationName: operationName ?? match[2] ?? null }
  }
  if (SHORTHAND_QUERY_RE.test(document)) {
    return { operationType: 'query', operationName: operationName ?? null }
  }
  return null
}

/** A JSON body shaped like a GraphQL request: `{ query: string, operationName?, variables? }`. */
function graphqlFromJsonBody(text: string): Classification['graphql'] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const first: unknown = Array.isArray(parsed) ? (parsed as unknown[])[0] : parsed
  if (typeof first !== 'object' || first === null) return null
  const record = first as Record<string, unknown>
  if (typeof record['query'] !== 'string') return null
  const name = typeof record['operationName'] === 'string' ? record['operationName'] : null
  return graphqlOperationOf(record['query'], name)
}

export function classifyCapture(input: ClassificationInput): Classification {
  const requestContentType = headerValue(input.requestHeaders, 'content-type')
  if (isGrpcWebContentType(requestContentType) || isGrpcWebContentType(input.responseMimeType) || isGrpcWebContentType(headerValue(input.responseHeaders, 'content-type'))) {
    const route = grpcRouteOf(input.url)
    return route ? { protocol: 'grpc-web', grpc: route } : { protocol: 'grpc-web' }
  }
  if (input.requestBodyText !== null) {
    if (isGraphqlContentType(requestContentType)) {
      const op = graphqlOperationOf(input.requestBodyText)
      return op ? { protocol: 'graphql', graphql: op } : { protocol: 'graphql' }
    }
    const op = graphqlFromJsonBody(input.requestBodyText)
    if (op) return { protocol: 'graphql', graphql: op }
  }
  if (input.method.toUpperCase() === 'GET') {
    // GraphQL over GET: `?query=…`.
    try {
      const params = new URL(input.url).searchParams
      const query = params.get('query')
      if (query !== null) {
        const op = graphqlOperationOf(query, params.get('operationName'))
        if (op) return { protocol: 'graphql', graphql: op }
      }
    } catch {
      // not a url — plain http
    }
  }
  return { protocol: 'http' }
}

const WS_TYPE_FIELDS = ['type', 'event', 'action', 'op', 'topic', 'channel', 'method']

/** The discriminant of a WebSocket text message: the first conventional
 * field (`type`, `event`, `action`, …) carrying a string, or `null`. */
export function websocketMessageTypeOf(payload: string): string | null {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  // Socket.IO / engine.io style `["event", payload]` arrays.
  if (Array.isArray(parsed)) {
    const first: unknown = parsed[0]
    return typeof first === 'string' && first.length <= 100 ? first : null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  for (const field of WS_TYPE_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.length > 0 && value.length <= 100) return value
  }
  return null
}
