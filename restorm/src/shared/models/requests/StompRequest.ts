/**
 * StompRequest - STOMP (over WebSocket) request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon } from '../types'
import type { StompVersion, StompSubscription } from '../../types/requests/StompRequest'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/** Materialise one persisted/plain subscription entry into the runtime shape
 * (missing fields fall back to sane defaults). */
function subscriptionFromPlain(s: Partial<StompSubscription>): StompSubscription {
  return {
    id: s.id ?? '',
    destination: s.destination ?? '',
    ackMode: s.ackMode ?? 'auto'
  }
}

/**
 * STOMP request definition: connect headers + subscriptions established on
 * CONNECT, plus a Send pane (destination / body / headers) for SEND frames.
 */
@fileNaming({ pattern: '{index} - STOMP - {name}', nameProperty: 'name', idProperty: 'id' })
export class StompRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'stomp'

  /** STOMP-over-WebSocket URL (ws:// or wss://) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Negotiated STOMP protocol version. Plain `String` in the GraphQL schema
   * (not a registered enum) — `1.1` / `1.2` are not valid GraphQL enum value
   * names (leading digit + a dot), unlike `WebSocketProtocol` / `GrpcCallType`
   * which have word-shaped variants. */
  @graphqlField({ type: 'String' })
  @searchable.property({ filterable: true })
  stompVersion: StompVersion = '1.2'

  /** CONNECT frame headers (host, login, passcode, heart-beat, …) */
  @graphqlField({ type: 'KeyValue', isArray: true })
  connectHeaders: KeyValue[] = []

  /** SUBSCRIBEs issued right after CONNECTED */
  subscriptions: StompSubscription[] = []

  /** Default destination for the Send button's SEND frame */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  sendDestination = ''

  /** Default body for the Send button's SEND frame */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  sendBody = ''

  /** Custom headers merged onto the SEND frame */
  @graphqlField({ type: 'KeyValue', isArray: true })
  sendHeaders: KeyValue[] = []

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<StompRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.connectHeaders) {
        this.connectHeaders = init.connectHeaders.map(h =>
          h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
      if (init.sendHeaders) {
        this.sendHeaders = init.sendHeaders.map(h =>
          h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
      if (init.subscriptions) {
        this.subscriptions = init.subscriptions.map(s => subscriptionFromPlain(s))
      }
    }
  }

  /**
   * Create a StompRequest from a plain object
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
    stompVersion?: StompVersion
    connectHeaders?: Parameters<typeof KeyValue.fromPlain>[0][]
    subscriptions?: Partial<StompSubscription>[]
    sendDestination?: string
    sendBody?: string
    sendHeaders?: Parameters<typeof KeyValue.fromPlain>[0][]
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): StompRequest {
    return new StompRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      stompVersion: obj.stompVersion ?? '1.2',
      connectHeaders: (obj.connectHeaders ?? []) as KeyValue[],
      subscriptions: (obj.subscriptions ?? []).map(s => subscriptionFromPlain(s)),
      sendDestination: obj.sendDestination ?? '',
      sendBody: obj.sendBody ?? '',
      sendHeaders: (obj.sendHeaders ?? []) as KeyValue[],
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this StompRequest
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
      stompVersion: this.stompVersion,
      connectHeaders: this.connectHeaders.map(h => h.toPlainObject()),
      subscriptions: this.subscriptions,
      sendDestination: this.sendDestination,
      sendBody: this.sendBody,
      sendHeaders: this.sendHeaders.map(h => h.toPlainObject()),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
