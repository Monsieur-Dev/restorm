import type { RuntimeId } from '../baseTypes'

export interface HTTPTimings {
  startedAt: string
  durationMs: number
  dnsLookupMs?: number
  tcpConnectionMs?: number
  tlsHandshakeMs?: number
  ttfbMs?: number
  downloadMs?: number
}

export interface HTTPNetworkInfo {
  remoteAddress?: string
  localAddress?: string
  protocol?: string
}

export interface BaseResponse {
  id: RuntimeId
  requestId: RuntimeId
  error?: string | undefined
}
