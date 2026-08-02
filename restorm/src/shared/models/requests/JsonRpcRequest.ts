/**
 * JsonRpcRequest / JsonRpcBatchRequest — JSON-RPC 2.0 calls. A single call
 * composes `{ jsonrpc: '2.0', method, params, id }` and POSTs it as JSON; a
 * batch POSTs an array of such envelopes in one call. Both execute through
 * `HTTPExecutionService` (JSON-RPC is HTTP-shaped) via a thin request-shaping
 * layer in `JsonRpcExecutionService`.
 */

import {
  searchable,
  fileNaming,
  graphqlField
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import { KeyValue } from '../KeyValue'
import type { RequestType, RuntimeId, Icon } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'
import type { JsonRpcBatchCallSpec } from '../../types/requests/JsonRpcRequest'

export type { JsonRpcBatchCallSpec }

@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class JsonRpcRequest extends BaseRequest {
  readonly type: RequestType = 'jsonrpc'

  /** Endpoint URL the envelope is POSTed to. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Extra request headers forwarded to the underlying HTTP POST. */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** RPC method name. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  method = ''

  /** Raw JSON source for `params` — a `[...]` array (positional) or a
   * `{...}` object (named). Parsed at execution time. */
  @graphqlField({ type: 'String', nullable: true })
  params = ''

  /** JSON-RPC request id. Empty ⇒ auto-generated at execution time. */
  @graphqlField({ type: 'String', nullable: true })
  rpcId = ''

  /** When true, the envelope carries no `id` and no response is unwrapped. */
  @graphqlField({ type: 'Boolean', nullable: true })
  notificationMode?: boolean

  @graphqlField({ type: 'Boolean', nullable: true })
  override deprecated = false

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<JsonRpcRequest>) {
    super(init)
    if (init) {
      const { headers, ...rest } = init
      Object.assign(this, rest)
      this.headers = (headers ?? []).map(h =>
        h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
    }
  }

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
    method?: string
    params?: string
    rpcId?: string
    notificationMode?: boolean
    deprecated?: boolean
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): JsonRpcRequest {
    return new JsonRpcRequest({
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
      method: obj.method ?? '',
      params: obj.params ?? '',
      rpcId: obj.rpcId ?? '',
      ...(obj.notificationMode !== undefined && { notificationMode: obj.notificationMode }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

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
      method: this.method,
      params: this.params,
      rpcId: this.rpcId,
      ...(this.notificationMode !== undefined && { notificationMode: this.notificationMode }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}

@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class JsonRpcBatchRequest extends BaseRequest {
  readonly type: RequestType = 'jsonrpcBatch'

  /** Endpoint URL the batch array is POSTed to. */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** Extra request headers forwarded to the underlying HTTP POST. */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** Child RPC calls composed into the batch array. */
  @graphqlField({ type: 'JSON' })
  children: JsonRpcBatchCallSpec[] = []

  @graphqlField({ type: 'Boolean', nullable: true })
  override deprecated = false

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

  constructor(init?: Partial<JsonRpcBatchRequest>) {
    super(init)
    if (init) {
      const { headers, ...rest } = init
      Object.assign(this, rest)
      this.headers = (headers ?? []).map(h =>
        h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
    }
  }

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
    children?: JsonRpcBatchCallSpec[]
    deprecated?: boolean
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): JsonRpcBatchRequest {
    return new JsonRpcBatchRequest({
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
      children: obj.children ?? [],
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

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
      children: this.children,
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
