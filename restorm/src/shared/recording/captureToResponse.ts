/**
 * A captured call, re-expressed as the response object the protocol's own
 * request tab renders — so the captures pane shows a call with EXACTLY the
 * components a request's response uses (Response / Infos / Cookies / Graph
 * for HTTP, the chat for WebSocket, the JSON views for GraphQL and gRPC).
 */

import type {
  HTTPResponse,
  GraphQLResponse,
  GrpcResponse,
  WebSocketResponse,
  KeyValue,
  HTTPMethod
} from '../types/collections'
import type { CookiePair } from '../cookies/cookieTypes'
import type { CaptureHeader, RecordedCallDetail } from '../types/recordingCapture'
import { createTypedKeyValue } from '../utils/createTypedKeyValue'
import { headerValue } from './classifyCapture'

const HTTP_METHODS: readonly HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY']

function toKeyValues(headers: readonly CaptureHeader[]): KeyValue[] {
  return headers.map((h) => createTypedKeyValue({ key: h.key, value: h.value, enabled: true }))
}

function timingsOf(detail: RecordedCallDetail): HTTPResponse['timings'] {
  return { startedAt: new Date(detail.timestamp).toISOString(), durationMs: detail.durationMs ?? 0 }
}

/** `Cookie: a=1; b=2` → pairs. */
function sentCookiesOf(headers: readonly CaptureHeader[]): CookiePair[] | undefined {
  const raw = headerValue(headers, 'cookie')
  if (raw === null || raw.trim() === '') return undefined
  return raw.split(';').map((part) => part.trim()).filter((part) => part !== '').map((part) => {
    const eq = part.indexOf('=')
    return eq < 0 ? { name: part, value: '' } : { name: part.slice(0, eq), value: part.slice(eq + 1) }
  })
}

/** Every `Set-Cookie` line (Chromium joins several with `\n`) → name/value pairs. */
function receivedCookiesOf(headers: readonly CaptureHeader[]): CookiePair[] | undefined {
  const lines = headers.filter((h) => h.key.toLowerCase() === 'set-cookie').flatMap((h) => h.value.split('\n'))
  if (lines.length === 0) return undefined
  return lines.map((line) => {
    const first = line.split(';')[0] ?? ''
    const eq = first.indexOf('=')
    return eq < 0 ? { name: first.trim(), value: '' } : { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() }
  })
}

function bodyText(body: { encoding: 'utf8' | 'base64'; data: string } | null | undefined): string {
  if (!body) return ''
  return body.data
}

export function captureToHttpResponse(detail: RecordedCallDetail): HTTPResponse {
  const method = detail.method.toUpperCase()
  const requestBody = detail.request.body
  const responseBody = detail.response?.body ?? null
  const sent = sentCookiesOf(detail.request.headers)
  const received = detail.response ? receivedCookiesOf(detail.response.headers) : undefined
  return {
    type: 'http',
    id: detail.id,
    requestId: detail.sessionId,
    requestUrl: detail.url,
    requestMethod: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HTTPMethod) : 'GET',
    requestHeaders: toKeyValues(detail.request.headers),
    requestParams: toKeyValues(detail.request.query),
    ...(requestBody ? { requestBody: { type: 'text' as const, content: bodyText(requestBody) } } : {}),
    statusCode: detail.status ?? 0,
    statusText: detail.statusText ?? (detail.error ?? ''),
    responseHeaders: toKeyValues(detail.response?.headers ?? []),
    responseBody: bodyText(responseBody),
    ...(responseBody?.encoding === 'base64' ? { bodyIsBase64: true } : {}),
    ...(detail.mimeType !== undefined ? { contentType: detail.mimeType } : {}),
    ...(detail.responseSize !== undefined ? { contentLength: detail.responseSize } : {}),
    timings: timingsOf(detail),
    ...(detail.error !== undefined ? { error: detail.error } : {}),
    ...(sent !== undefined ? { sentCookies: sent } : {}),
    ...(received !== undefined ? { receivedCookies: received } : {})
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export function captureToGraphqlResponse(detail: RecordedCallDetail): GraphQLResponse {
  const requestJson = parseJson(bodyText(detail.request.body)) as { query?: unknown; variables?: unknown } | undefined
  const responseJson = parseJson(bodyText(detail.response?.body)) as { data?: unknown; errors?: unknown } | undefined
  const errors = Array.isArray(responseJson?.errors) ? responseJson.errors as GraphQLResponse['errors'] : undefined
  const sent = sentCookiesOf(detail.request.headers)
  const received = detail.response ? receivedCookiesOf(detail.response.headers) : undefined
  return {
    type: 'graphql',
    id: detail.id,
    requestId: detail.sessionId,
    requestUrl: detail.url,
    requestQuery: typeof requestJson?.query === 'string' ? requestJson.query : bodyText(detail.request.body),
    ...(requestJson?.variables !== undefined ? { requestVariables: JSON.stringify(requestJson.variables, null, 2) } : {}),
    requestHeaders: toKeyValues(detail.request.headers),
    statusCode: detail.status ?? 0,
    ...(responseJson?.data !== undefined ? { data: responseJson.data } : {}),
    ...(errors !== undefined ? { errors } : {}),
    responseHeaders: toKeyValues(detail.response?.headers ?? []),
    timings: timingsOf(detail),
    ...(detail.error !== undefined ? { error: detail.error } : {}),
    ...(sent !== undefined ? { sentCookies: sent } : {}),
    ...(received !== undefined ? { receivedCookies: received } : {})
  }
}

export function captureToGrpcResponse(detail: RecordedCallDetail): GrpcResponse {
  const responseHeaders = detail.response?.headers ?? []
  const grpcStatus = headerValue(responseHeaders, 'grpc-status')
  const statusCode = grpcStatus !== null && /^\d+$/.test(grpcStatus) ? Number(grpcStatus) : (detail.status !== undefined && detail.status >= 200 && detail.status < 300 ? 0 : 2)
  return {
    type: 'grpc',
    id: detail.id,
    requestId: detail.sessionId,
    requestUrl: detail.url,
    requestMethod: detail.grpc ? `${detail.grpc.service}/${detail.grpc.method}` : detail.url,
    requestMessage: bodyText(detail.request.body),
    requestMetadata: toKeyValues(detail.request.headers),
    statusCode,
    statusMessage: headerValue(responseHeaders, 'grpc-message') ?? detail.statusText ?? '',
    responseMessage: bodyText(detail.response?.body),
    responseMetadata: toKeyValues(responseHeaders),
    timings: timingsOf(detail),
    ...(detail.error !== undefined ? { error: detail.error } : {})
  }
}

export function captureToWebSocketResponse(detail: RecordedCallDetail): WebSocketResponse {
  return {
    type: 'websocket',
    id: detail.id,
    requestId: detail.sessionId,
    requestUrl: detail.url,
    protocol: 'websocket',
    connected: detail.websocket ? !detail.websocket.closed : false,
    messages: (detail.websocketFrames ?? []).map((frame) => ({
      direction: frame.direction,
      data: frame.payload,
      timestamp: new Date(frame.timestamp).toISOString()
    })),
    timings: timingsOf(detail),
    ...(detail.error !== undefined ? { error: detail.error } : {})
  }
}
