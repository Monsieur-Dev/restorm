/**
 * A captured call as a response-history detail — the same record a real
 * run of the request would have written to the sidecar zip — so a request
 * deduced from a recording session opens with the history of the calls it
 * was deduced from. Built from the capture alone (headers, bodies, frames
 * as they were on the wire), not from the request's current shape.
 */

import { randomUUID } from 'node:crypto'
import type { ResponseHistoryDetail, ResponseHistoryKeyValue, ResponseHistoryOutcome, ResponseHistoryResponse } from '../../../shared/types/responseHistory'
import type { CaptureHeader, RecordedCallDetail } from '../../../shared/types/recordingCapture'
import { headerValue } from '../../../shared/recording/classifyCapture'

function kvs(headers: readonly CaptureHeader[]): ResponseHistoryKeyValue[] {
  return headers.map((h) => ({ key: h.key, value: h.value, enabled: true }))
}

function cookiePairs(raw: string | null): ResponseHistoryKeyValue[] | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const pairs = raw.split(';').map((p) => p.trim()).filter((p) => p !== '').map((part) => {
    const eq = part.indexOf('=')
    return eq < 0 ? { key: part, value: '' } : { key: part.slice(0, eq), value: part.slice(eq + 1) }
  })
  return pairs.length > 0 ? pairs : undefined
}

function setCookiePairs(headers: readonly CaptureHeader[]): ResponseHistoryKeyValue[] | undefined {
  const lines = headers.filter((h) => h.key.toLowerCase() === 'set-cookie').flatMap((h) => h.value.split('\n'))
  if (lines.length === 0) return undefined
  return lines.map((line) => {
    const first = line.split(';')[0] ?? ''
    const eq = first.indexOf('=')
    return eq < 0 ? { key: first.trim(), value: '' } : { key: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() }
  })
}

export function captureOutcome(detail: RecordedCallDetail): ResponseHistoryOutcome {
  if (detail.error !== undefined) return 'failure'
  if (detail.protocol === 'websocket') return detail.status === 101 || detail.status === undefined ? 'ok' : 'failure'
  if (detail.protocol === 'grpc-web') {
    const grpcStatus = headerValue(detail.response?.headers ?? [], 'grpc-status')
    if (grpcStatus !== null) return grpcStatus === '0' ? 'ok' : 'failure'
  }
  const status = detail.status ?? 0
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 300 && status < 400) return 'warning'
  return 'failure'
}

function timings(detail: RecordedCallDetail): { startedAt: string; durationMs: number } {
  return { startedAt: new Date(detail.timestamp).toISOString(), durationMs: detail.durationMs ?? 0 }
}

function text(body: { encoding: string; data: string } | null | undefined): string {
  return body ? body.data : ''
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function responseOf(detail: RecordedCallDetail): ResponseHistoryResponse {
  const requestHeaders = detail.request.headers
  const responseHeaders = detail.response?.headers ?? []
  const sent = cookiePairs(headerValue(requestHeaders, 'cookie'))
  const received = setCookiePairs(responseHeaders)
  const base = {
    ...(sent !== undefined ? { sentCookies: sent } : {}),
    ...(received !== undefined ? { receivedCookies: received } : {}),
    ...(detail.error !== undefined ? { error: detail.error } : {}),
    timings: timings(detail)
  }
  switch (detail.protocol) {
    case 'graphql': {
      const parsed = parseJson(text(detail.response?.body)) as { data?: unknown; errors?: unknown } | undefined
      return {
        ...base,
        type: 'graphql',
        requestUrl: detail.url,
        requestHeaders: kvs(requestHeaders),
        statusCode: detail.status ?? 0,
        ...(parsed?.data !== undefined ? { data: parsed.data } : {}),
        ...(Array.isArray(parsed?.errors) ? { errors: parsed.errors as { message: string }[] } : {}),
        responseHeaders: kvs(responseHeaders)
      }
    }
    case 'grpc-web': {
      const grpcStatus = headerValue(responseHeaders, 'grpc-status')
      return {
        ...base,
        type: 'grpc',
        requestUrl: detail.url,
        requestMethod: detail.grpc ? `${detail.grpc.service}/${detail.grpc.method}` : detail.url,
        requestMessage: text(detail.request.body),
        requestMetadata: kvs(requestHeaders),
        statusCode: grpcStatus !== null && /^\d+$/.test(grpcStatus) ? Number(grpcStatus) : (captureOutcome(detail) === 'ok' ? 0 : 2),
        statusMessage: headerValue(responseHeaders, 'grpc-message') ?? detail.statusText ?? '',
        responseMessage: text(detail.response?.body),
        responseMetadata: kvs(responseHeaders)
      }
    }
    case 'websocket':
      return {
        ...base,
        type: 'websocket',
        requestUrl: detail.url,
        protocol: 'websocket',
        connected: detail.websocket ? !detail.websocket.closed : false,
        messages: (detail.websocketFrames ?? []).map((frame) => ({ direction: frame.direction, data: frame.payload, timestamp: new Date(frame.timestamp).toISOString() }))
      }
    default: {
      const requestBody = detail.request.body
      return {
        ...base,
        type: 'http',
        requestUrl: detail.url,
        requestMethod: detail.method.toUpperCase(),
        requestHeaders: kvs(requestHeaders),
        requestParams: kvs(detail.request.query),
        requestPathParams: [],
        ...(requestBody ? { requestBody: { type: 'text' as const, content: text(requestBody) } } : {}),
        statusCode: detail.status ?? 0,
        statusText: detail.statusText ?? (detail.error ?? ''),
        responseHeaders: kvs(responseHeaders),
        responseBody: text(detail.response?.body),
        ...(detail.mimeType !== undefined ? { contentType: detail.mimeType } : {}),
        ...(detail.responseSize !== undefined ? { contentLength: detail.responseSize } : {})
      }
    }
  }
}

/** The history record of one captured call for the request deduced from it. */
export function captureToHistoryDetail(requestId: string, detail: RecordedCallDetail, pinned: boolean): ResponseHistoryDetail {
  const type = detail.protocol === 'grpc-web' ? 'grpc' : detail.protocol
  return {
    guid: randomUUID(),
    requestId,
    type,
    outcome: captureOutcome(detail),
    timestamp: new Date(detail.timestamp).toISOString(),
    pinned,
    ...(detail.grpc ? { requestMeta: { service: detail.grpc.service, method: detail.grpc.method, callType: 'unary' } } : {}),
    ...(detail.protocol === 'websocket' ? { requestMeta: { protocol: 'websocket' } } : {}),
    response: responseOf(detail)
  }
}
