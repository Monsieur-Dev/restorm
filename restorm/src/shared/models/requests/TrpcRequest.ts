/**
 * TrpcRequest - tRPC request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon, TrpcCallKind } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * tRPC request definition: a base server URL, a dot-separated procedure
 * path, a JSON input, and a query/mutation kind.
 */
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class TrpcRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'trpc'

  /** Base tRPC server URL — the procedure path is appended by the
   * execution layer. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Dot-separated procedure path, e.g. `user.get`, `post.create`. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1 })
  procedure = ''

  /** JSON object passed as the procedure's `input`. */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  input?: string

  /** query → GET with `?input=`; mutation → POST with the v10 body envelope. */
  @graphqlField({ type: 'TrpcCallKind' })
  @searchable.property({ filterable: true })
  kind: TrpcCallKind = 'query'

  /** HTTP headers */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<TrpcRequest>) {
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
   * Create a TrpcRequest from a plain object
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
    procedure?: string
    input?: string
    kind?: TrpcCallKind
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    quickConfigs?: QuickConfig[]
  }): TrpcRequest {
    return new TrpcRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      url: obj.url ?? '',
      procedure: obj.procedure ?? '',
      ...(obj.input !== undefined && { input: obj.input }),
      kind: obj.kind ?? 'query',
      headers: (obj.headers ?? []) as KeyValue[],
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this TrpcRequest
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
      procedure: this.procedure,
      input: this.input,
      kind: this.kind,
      headers: this.headers.map(h => h.toPlainObject()),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
