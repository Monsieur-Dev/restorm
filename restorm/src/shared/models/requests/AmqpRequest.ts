/**
 * AmqpRequest - AMQP 0-9-1 (RabbitMQ) request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import type { AmqpMode, RequestType, RuntimeId, Icon } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * AMQP request definition. One request type carries all three interaction
 * modes (`publish` / `subscribe` / `browse`) — the tab view swaps its pane on
 * `mode`, and the fields for the other two modes stay populated but unused so
 * switching modes back and forth doesn't lose what the user typed.
 */
@fileNaming({ pattern: '{index} - AMQP - {name}', nameProperty: 'name', idProperty: 'id' })
export class AmqpRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'amqp'

  /** Broker URL (amqp:// or amqps://) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Virtual host (defaults to `/` when empty) */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  vhost?: string

  /** Which of the three interactions this request performs */
  @graphqlField({ type: 'AmqpMode' })
  @searchable.property({ filterable: true })
  mode: AmqpMode = 'publish'

  // ----------------------------------------------------------------------
  // Publish (mode === 'publish')
  // ----------------------------------------------------------------------

  /** Destination exchange (empty string = the default exchange) */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  exchange?: string

  /** Routing key */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  routingKey?: string

  /** Message payload */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  payload?: string

  // ----------------------------------------------------------------------
  // Subscribe (mode === 'subscribe') / Browse (mode === 'browse')
  // ----------------------------------------------------------------------

  /** Source queue name */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  queue?: string

  /** Ack received messages automatically (subscribe only; default true) */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  autoAck?: boolean

  /** `channel.prefetch` — max unacked messages in flight (subscribe only) */
  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  prefetch?: number

  /** Max messages to peek without acking (browse only; default 50) */
  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  browsePeekCount?: number

  // ----------------------------------------------------------------------
  // Auth
  // ----------------------------------------------------------------------

  /** Auth username (handlebars-resolved) */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  username?: string

  /** Auth password (handlebars-resolved; may resolve from a secret) */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  password?: string

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<AmqpRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
    }
  }

  /**
   * Create an AmqpRequest from a plain object
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
    vhost?: string
    mode?: AmqpMode
    exchange?: string
    routingKey?: string
    payload?: string
    queue?: string
    autoAck?: boolean
    prefetch?: number
    browsePeekCount?: number
    username?: string
    password?: string
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): AmqpRequest {
    return new AmqpRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      ...(obj.vhost !== undefined && { vhost: obj.vhost }),
      mode: obj.mode ?? 'publish',
      ...(obj.exchange !== undefined && { exchange: obj.exchange }),
      ...(obj.routingKey !== undefined && { routingKey: obj.routingKey }),
      ...(obj.payload !== undefined && { payload: obj.payload }),
      ...(obj.queue !== undefined && { queue: obj.queue }),
      ...(obj.autoAck !== undefined && { autoAck: obj.autoAck }),
      ...(obj.prefetch !== undefined && { prefetch: obj.prefetch }),
      ...(obj.browsePeekCount !== undefined && { browsePeekCount: obj.browsePeekCount }),
      ...(obj.username !== undefined && { username: obj.username }),
      ...(obj.password !== undefined && { password: obj.password }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this AmqpRequest
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
      ...pickImportMarkers(this),
      url: this.url,
      ...(this.vhost !== undefined && { vhost: this.vhost }),
      mode: this.mode,
      ...(this.exchange !== undefined && { exchange: this.exchange }),
      ...(this.routingKey !== undefined && { routingKey: this.routingKey }),
      ...(this.payload !== undefined && { payload: this.payload }),
      ...(this.queue !== undefined && { queue: this.queue }),
      ...(this.autoAck !== undefined && { autoAck: this.autoAck }),
      ...(this.prefetch !== undefined && { prefetch: this.prefetch }),
      ...(this.browsePeekCount !== undefined && { browsePeekCount: this.browsePeekCount }),
      ...(this.username !== undefined && { username: this.username }),
      ...(this.password !== undefined && { password: this.password }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
