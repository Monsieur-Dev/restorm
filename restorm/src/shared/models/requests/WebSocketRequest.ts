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
    url?: string
    protocol?: WebSocketProtocol
    event?: string
    message?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
  }): WebSocketRequest {
    return new WebSocketRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      url: obj.url ?? '',
      protocol: obj.protocol ?? 'websocket',
      ...(obj.event !== undefined && { event: obj.event }),
      message: obj.message ?? '',
      headers: (obj.headers ?? []) as KeyValue[]
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
      url: this.url,
      protocol: this.protocol,
      event: this.event,
      message: this.message,
      headers: this.headers.map(h => h.toPlainObject())
    }
  }
}
