import type { BaseResponse, HTTPTimings } from './BaseResponse'

/** One STOMP frame exchanged on the connection (sent CONNECT/SUBSCRIBE/SEND/
 * ACK/NACK/DISCONNECT, or received CONNECTED/MESSAGE/RECEIPT/ERROR). */
export interface StompMessage {
  direction: 'sent' | 'received'
  /** The STOMP command (`CONNECTED`, `MESSAGE`, `ERROR`, …). */
  command: string
  /** Subscription id a received `MESSAGE`/`ERROR` frame carries (its
   * `subscription` header), when applicable. */
  subscription?: string | undefined
  /** Destination a received `MESSAGE` frame carries (its `destination`
   * header), when applicable. */
  destination?: string | undefined
  /** The frame's raw headers (in wire order). */
  headers: Record<string, string>
  body: string
  timestamp: string
}

export interface StompResponse extends BaseResponse {
  type: 'stomp'
  requestUrl: string
  connected: boolean
  messages: StompMessage[]
  timings: HTTPTimings
}
