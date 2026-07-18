/**
 * HTTPRequest - HTTP request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { RequestType, HTTPBodyType, RuntimeId, Icon } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

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
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class HTTPRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'http'

  /** HTTP method. A well-known verb (GET/POST/…/QUERY) or an arbitrary custom
   * token — method tokens are case-sensitive (RFC 9110 §5.1.1), so this is a
   * free string, not the well-known-verb enum. */
  @graphqlField({ type: 'String' })
  @searchable.property({ filterable: true })
  method = 'GET'

  /** Request URL (may contain environment variable placeholders) */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** HTTP headers */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** URL query parameters (e.g. ?page=1) */
  @graphqlField({ type: 'KeyValue', isArray: true })
  params: KeyValue[] = []

  /** URL path parameters (e.g. /users/{id}) */
  @graphqlField({ type: 'KeyValue', isArray: true, nullable: true })
  pathParams: KeyValue[] = []

  /** Optional request body */
  @graphqlField({ type: 'JSON', nullable: true })
  body?: HTTPRequestBody

  /** Whether this endpoint is deprecated */
  @graphqlField({ type: 'Boolean', nullable: true })
  deprecated = false

  /** When true, restorm ACTS AS a local HTTP mock server: it listens on
   * `localhost:<port><path>` for this request's METHOD + PATH and answers with
   * the configured response (status/headers/body) instead of sending the
   * request as a client. The URL then carries only `localhost:<port><path>`
   * (host is fixed). */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  server?: boolean

  /** HTTP status code the mock serves (server mode; defaults to 200). */
  @graphqlField({ type: 'Int', nullable: true })
  @TreatEmptyAsUndefined()
  mockStatus?: number

  /** Per-request timeout in milliseconds. When unset the executor
   * falls back to the global default (`DEFAULT_REQUEST_TIMEOUT_MS`). */
  @graphqlField({ type: 'Int', nullable: true })
  timeout?: number

  /** Whether the executor follows 3xx redirects (301/302/303/307/308).
   * Undefined defaults to `true` at dispatch — most users expect a Send
   * to land on the final resource; the toggle lets them inspect the raw
   * redirect response instead. */
  @graphqlField({ type: 'Boolean', nullable: true })
  followRedirects?: boolean

  /** User-saved quick-config snapshots for this request.
   * Stored directly in the .restorm project file (project target).
   * The user-settings target is stored separately via window.api.storage. */
  quickConfigs?: QuickConfig[]

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
    authenticationRequestId?: RuntimeId
    method?: string
    url?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    params?: Parameters<typeof KeyValue.fromPlain>[0][]
    pathParams?: Parameters<typeof KeyValue.fromPlain>[0][]
    body?: HTTPRequestBody
    deprecated?: boolean
    server?: boolean
    mockStatus?: number
    timeout?: number
    followRedirects?: boolean
    quickConfigs?: QuickConfig[]
  }): HTTPRequest {
    return new HTTPRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      method: obj.method ?? 'GET',
      url: obj.url ?? '',
      headers: (obj.headers ?? []) as KeyValue[],
      params: (obj.params ?? []) as KeyValue[],
      pathParams: (obj.pathParams ?? []) as KeyValue[],
      ...(obj.body !== undefined && { body: obj.body }),
      deprecated: obj.deprecated ?? false,
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.mockStatus !== undefined && { mockStatus: obj.mockStatus }),
      ...(obj.timeout !== undefined && { timeout: obj.timeout }),
      ...(obj.followRedirects !== undefined && { followRedirects: obj.followRedirects }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
    })
  }

  /**
   * Create a plain object from this HTTPRequest
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
      method: this.method,
      url: this.url,
      headers: this.headers.map(h => h.toPlainObject()),
      params: this.params.map(p => p.toPlainObject()),
      pathParams: this.pathParams.map(p => p.toPlainObject()),
      body: this.body,
      deprecated: this.deprecated,
      ...(this.server !== undefined && { server: this.server }),
      ...(this.mockStatus !== undefined && { mockStatus: this.mockStatus }),
      ...(this.timeout !== undefined && { timeout: this.timeout }),
      ...(this.followRedirects !== undefined && { followRedirects: this.followRedirects }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
