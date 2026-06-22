/**
 * WebSocketRequest - WebSocket/Socket.IO/MQTT request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { WebSocketProtocol, RequestType, RuntimeId, Icon } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * WebSocket request definition with protocol, event, and message.
 */
@fileNaming({ pattern: '{index} - WS - {name}', nameProperty: 'name', idProperty: 'id' })
export class WebSocketRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'websocket'

  /** WebSocket URL (ws:// or wss://) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Protocol type */
  @graphqlField({ type: 'WebSocketProtocol' })
  @searchable.property({ filterable: true })
  protocol: WebSocketProtocol = 'websocket'

  /** Event/channel name (for Socket.IO/MQTT) */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  event?: string

  /** Message payload as JSON string */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  message = ''

  /** Connection headers/options */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** When true, restorm ACTS AS the server (hosts a socket.io server on
   * localhost) instead of connecting as a client. The URL then carries only
   * `localhost:<port>[/<route>]` (host is fixed). Server mode has no env / auth /
   * docs. */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  server?: boolean

  // ----------------------------------------------------------------------
  // MQTT-specific (protocol === 'mqtt'). All optional so the websocket /
  // socketio paths are unaffected. `event` carries the MQTT topic.
  // ----------------------------------------------------------------------

  /** QoS level (0 | 1 | 2) used for both publish and the on-connect subscribe. */
  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  qos?: number

  /** Publish retain flag. */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  retain?: boolean

  /** Client id (handlebars-resolved; the client auto-generates one when empty). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  clientId?: string

  /** Auth username (handlebars-resolved). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  username?: string

  /** Auth password (handlebars-resolved; may resolve from a secret). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  password?: string

  /** Keepalive interval in seconds. */
  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  keepalive?: number

  /** Subscribe to the request's topic on connect so received messages stream
   * into the response panel. Defaults to true; turn off for a pure publisher. */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  mqttSubscribe?: boolean

  /** Last Will & Testament — the broker publishes this if the client drops. */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  lwtTopic?: string

  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  lwtPayload?: string

  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  lwtQos?: number

  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  lwtRetain?: boolean

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<WebSocketRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.headers) {
        this.headers = init.headers.map(h =>
          h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
    }
  }

  /**
   * Create a WebSocketRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    authenticationRequestId?: RuntimeId
    url?: string
    protocol?: WebSocketProtocol
    event?: string
    message?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    server?: boolean
    qos?: number
    retain?: boolean
    clientId?: string
    username?: string
    password?: string
    keepalive?: number
    mqttSubscribe?: boolean
    lwtTopic?: string
    lwtPayload?: string
    lwtQos?: number
    lwtRetain?: boolean
    quickConfigs?: QuickConfig[]
  }): WebSocketRequest {
    return new WebSocketRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      url: obj.url ?? '',
      protocol: obj.protocol ?? 'websocket',
      ...(obj.event !== undefined && { event: obj.event }),
      message: obj.message ?? '',
      headers: (obj.headers ?? []) as KeyValue[],
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.qos !== undefined && { qos: obj.qos }),
      ...(obj.retain !== undefined && { retain: obj.retain }),
      ...(obj.clientId !== undefined && { clientId: obj.clientId }),
      ...(obj.username !== undefined && { username: obj.username }),
      ...(obj.password !== undefined && { password: obj.password }),
      ...(obj.keepalive !== undefined && { keepalive: obj.keepalive }),
      ...(obj.mqttSubscribe !== undefined && { mqttSubscribe: obj.mqttSubscribe }),
      ...(obj.lwtTopic !== undefined && { lwtTopic: obj.lwtTopic }),
      ...(obj.lwtPayload !== undefined && { lwtPayload: obj.lwtPayload }),
      ...(obj.lwtQos !== undefined && { lwtQos: obj.lwtQos }),
      ...(obj.lwtRetain !== undefined && { lwtRetain: obj.lwtRetain }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this WebSocketRequest
   */
  toPlainObject(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      ...(this.authenticationRequestId !== undefined && { authenticationRequestId: this.authenticationRequestId }),
      url: this.url,
      protocol: this.protocol,
      event: this.event,
      message: this.message,
      headers: this.headers.map(h => h.toPlainObject()),
      ...(this.server !== undefined && { server: this.server }),
      ...(this.qos !== undefined && { qos: this.qos }),
      ...(this.retain !== undefined && { retain: this.retain }),
      ...(this.clientId !== undefined && { clientId: this.clientId }),
      ...(this.username !== undefined && { username: this.username }),
      ...(this.password !== undefined && { password: this.password }),
      ...(this.keepalive !== undefined && { keepalive: this.keepalive }),
      ...(this.mqttSubscribe !== undefined && { mqttSubscribe: this.mqttSubscribe }),
      ...(this.lwtTopic !== undefined && { lwtTopic: this.lwtTopic }),
      ...(this.lwtPayload !== undefined && { lwtPayload: this.lwtPayload }),
      ...(this.lwtQos !== undefined && { lwtQos: this.lwtQos }),
      ...(this.lwtRetain !== undefined && { lwtRetain: this.lwtRetain }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
