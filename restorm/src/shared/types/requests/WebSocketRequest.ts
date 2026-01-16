import type { BaseRequest } from './BaseRequest'
import type { WebSocketProtocol } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface WebSocketRequest extends BaseRequest {
  type: 'websocket'
  url: string
  protocol: WebSocketProtocol
  event?: string | undefined
  message: string
  headers: KeyValue[]
}
