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
  /** When true, restorm hosts a socket.io server (localhost:port[/route])
   * instead of connecting as a client. */
  server?: boolean | undefined

  // MQTT-specific (protocol === 'mqtt'; `event` carries the topic).
  /** QoS level (0 | 1 | 2) used for publish + the on-connect subscribe. */
  qos?: number | undefined
  /** Publish retain flag. */
  retain?: boolean | undefined
  /** Client id (handlebars-resolved; auto-generated when empty). */
  clientId?: string | undefined
  /** Auth username (handlebars-resolved). */
  username?: string | undefined
  /** Auth password (handlebars-resolved; may resolve from a secret). */
  password?: string | undefined
  /** Keepalive interval in seconds. */
  keepalive?: number | undefined
  /** Subscribe to the request's topic on connect (default true). */
  mqttSubscribe?: boolean | undefined
  /** Last Will & Testament. */
  lwtTopic?: string | undefined
  lwtPayload?: string | undefined
  lwtQos?: number | undefined
  lwtRetain?: boolean | undefined
}
