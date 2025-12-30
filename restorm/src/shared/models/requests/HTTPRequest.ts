/**
 * HTTPRequest - HTTP request definition
 */

import {
  searchable,
  fileNaming
} from 'electron-core-ui/main'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { HTTPMethod, RequestType, HTTPBodyType, RuntimeId, Icon } from '../types'

/** HTTP request body content */
export interface HTTPRequestBody {
  type: HTTPBodyType
  content?: string
  path?: string
  fields?: KeyValue[]
}

/**
 * HTTP request definition with method, URL, headers, params, and body.
 */
@fileNaming({ pattern: '{index} - {type} - {name}', typeProperty: 'method', nameProperty: 'name' })
export class HTTPRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'http'

  /** HTTP method (GET, POST, PUT, etc.) */
  @searchable.property({ filterable: true })
  method: HTTPMethod = 'GET'

  /** Request URL (may contain environment variable placeholders) */
  @searchable.property({ weight: 1.5 })
  url = ''

  /** HTTP headers */
  headers: KeyValue[] = []

  /** URL query parameters (e.g. ?page=1) */
  params: KeyValue[] = []

  /** URL path parameters (e.g. /users/{id}) */
  pathParams: KeyValue[] = []

  /** Optional request body */
  body?: HTTPRequestBody

  /** Whether this endpoint is deprecated */
  deprecated = false

  constructor(init?: Partial<HTTPRequest>) {
    super(init)
    if (init) {
      const { headers, params, pathParams, ...rest } = init
      Object.assign(this, rest)
      // Convert plain KeyValues
      this.headers = (headers ?? []).map(h =>
        h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.params = (params ?? []).map(p =>
        p instanceof KeyValue ? p : KeyValue.fromPlain(p as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.pathParams = (pathParams ?? []).map(p =>
        p instanceof KeyValue ? p : KeyValue.fromPlain(p as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
    }
  }

  /**
   * Create an HTTPRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    method?: HTTPMethod
    url?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    params?: Parameters<typeof KeyValue.fromPlain>[0][]
    pathParams?: Parameters<typeof KeyValue.fromPlain>[0][]
    body?: HTTPRequestBody
    deprecated?: boolean
  }): HTTPRequest {
    return new HTTPRequest({
      id: obj.id,
      name: obj.name ?? '',
      icon: obj.icon,
      documentation: obj.documentation ?? '',
      notes: obj.notes,
      tags: obj.tags ?? [],
      method: obj.method ?? 'GET',
      url: obj.url ?? '',
      headers: obj.headers as KeyValue[] | undefined,
      params: obj.params as KeyValue[] | undefined,
      pathParams: obj.pathParams as KeyValue[] | undefined,
      body: obj.body,
      deprecated: obj.deprecated ?? false
    })
  }

  /**
   * Create a plain object from this HTTPRequest
   */
  toPlainObject(): Record<string, unknown> {
    return {
      type: this.type,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      method: this.method,
      url: this.url,
      headers: this.headers.map(h => h.toPlainObject()),
      params: this.params.map(p => p.toPlainObject()),
      pathParams: this.pathParams.map(p => p.toPlainObject()),
      body: this.body,
      deprecated: this.deprecated
    }
  }
}
