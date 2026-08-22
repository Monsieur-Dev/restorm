import type { RuntimeId } from '../baseTypes'
import type { CookiePair } from '../../cookies/cookieTypes'

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
  /** Cookies actually SENT with this request (the effective `Cookie` header,
   * jar-injected + user-supplied), name→value. */
  sentCookies?: CookiePair[] | undefined
  /** Cookies RECEIVED by this response — every `Set-Cookie` across all hops
   * (redirects included), name→value. */
  receivedCookies?: CookiePair[] | undefined
}
