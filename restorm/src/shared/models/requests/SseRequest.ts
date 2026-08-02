/**
 * SseRequest - Server-Sent Events (text/event-stream) request definition
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
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * Server-Sent Events request: a URL + headers, streamed via a long-lived
 * `GET` with `Accept: text/event-stream`. Receive-only — there is no
 * message/payload field, unlike `WebSocketRequest`.
 */
@fileNaming({ pattern: '{index} - SSE - {name}', nameProperty: 'name', idProperty: 'id' })
export class SseRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'sse'

  /** SSE endpoint URL (http:// or https://) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Connection headers */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** Seed for the `Last-Event-ID` header on the first connect (handlebars-
   * resolved). A reconnect after that uses the last `id:` actually received. */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  lastEventId?: string

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<SseRequest>) {
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
   * Create a SseRequest from a plain object
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
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    lastEventId?: string
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): SseRequest {
    return new SseRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      headers: (obj.headers ?? []) as KeyValue[],
      ...(obj.lastEventId !== undefined && { lastEventId: obj.lastEventId }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this SseRequest
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
      headers: this.headers.map(h => h.toPlainObject()),
      ...(this.lastEventId !== undefined && { lastEventId: this.lastEventId }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
