import type { BaseResponse, HTTPTimings } from './BaseResponse'
import type { WebSocketProtocol } from '../requestPrimitives'

export interface WebSocketMessage {
  direction: 'sent' | 'received'
  event?: string | undefined
  data: string
  timestamp: string
}

export interface WebSocketResponse extends BaseResponse {
  type: 'websocket'
  requestUrl: string
  protocol: WebSocketProtocol
  connected: boolean
  messages: WebSocketMessage[]
  timings: HTTPTimings
}
