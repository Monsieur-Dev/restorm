/**
 * AuthenticationRequest — an HTTP request whose purpose is to
 * produce headers (typically `Authorization: Bearer <token>`) for
 * other requests to consume. Persisted identically to HTTPRequest
 * with three extra fields that drive the auth-specific behaviour.
 */

import {
  searchable,
  fileNaming,
  graphqlField
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { HTTPRequestBody } from './HTTPRequest'
import type { HTTPMethod, RuntimeId, Icon } from '../types'

const DEFAULT_AUTH_ERROR_CODES = [401, 403]

@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
export class AuthenticationRequest extends BaseRequest {
  readonly type = 'auth' as const

  @graphqlField({ type: 'HTTPMethod' })
  @searchable.property({ filterable: true })
  method: HTTPMethod = 'POST'

  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  @graphqlField({ type: 'KeyValue', isArray: true })
  params: KeyValue[] = []

  @graphqlField({ type: 'KeyValue', isArray: true, nullable: true })
  pathParams: KeyValue[] = []

  @graphqlField({ type: 'JSON', nullable: true })
  body?: HTTPRequestBody

  /** Headers to inject into every request that references this auth
   * route. `value` is a Handlebars expression evaluated against the
   * last response body (e.g. `{{token_type}} {{access_token}}`). */
  @graphqlField({ type: 'KeyValue', isArray: true })
  producedHeaders: KeyValue[] = []

  /** Handlebars expression that yields the seconds-until-expiry.
   * Empty / absent ⇒ never auto-expire (only the auth-error-code
   * path triggers a refresh). */
  @graphqlField({ type: 'String', nullable: true })
  expirationExpression?: string

  /** HTTP status codes on downstream requests that trigger an auth
   * refresh + one automatic retry. */
  @graphqlField({ type: 'Int', isArray: true })
  authErrorCodes: number[] = [...DEFAULT_AUTH_ERROR_CODES]

  @graphqlField({ type: 'Boolean', nullable: true })
  deprecated = false

  constructor(init?: Partial<AuthenticationRequest>) {
    super(init)
    if (init) {
      const { headers, params, pathParams, producedHeaders, ...rest } = init
      Object.assign(this, rest)
      this.headers = (headers ?? []).map((h) =>
        h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.params = (params ?? []).map((p) =>
        p instanceof KeyValue ? p : KeyValue.fromPlain(p as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.pathParams = (pathParams ?? []).map((p) =>
        p instanceof KeyValue ? p : KeyValue.fromPlain(p as unknown as Parameters<typeof KeyValue.fromPlain>[0])
      )
      this.producedHeaders = (producedHeaders ?? []).map((h) =>
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
    method?: HTTPMethod
    url?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    params?: Parameters<typeof KeyValue.fromPlain>[0][]
    pathParams?: Parameters<typeof KeyValue.fromPlain>[0][]
    body?: HTTPRequestBody
    producedHeaders?: Parameters<typeof KeyValue.fromPlain>[0][]
    expirationExpression?: string
    authErrorCodes?: number[]
    deprecated?: boolean
  }): AuthenticationRequest {
    return new AuthenticationRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      method: obj.method ?? 'POST',
      url: obj.url ?? '',
      headers: (obj.headers ?? []) as KeyValue[],
      params: (obj.params ?? []) as KeyValue[],
      pathParams: (obj.pathParams ?? []) as KeyValue[],
      ...(obj.body !== undefined && { body: obj.body }),
      producedHeaders: (obj.producedHeaders ?? []) as KeyValue[],
      ...(obj.expirationExpression !== undefined && { expirationExpression: obj.expirationExpression }),
      authErrorCodes: obj.authErrorCodes ?? [...DEFAULT_AUTH_ERROR_CODES],
      deprecated: obj.deprecated ?? false
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
      method: this.method,
      url: this.url,
      headers: this.headers.map((h) => h.toPlainObject()),
      params: this.params.map((p) => p.toPlainObject()),
      pathParams: this.pathParams.map((p) => p.toPlainObject()),
      body: this.body,
      producedHeaders: this.producedHeaders.map((h) => h.toPlainObject()),
      ...(this.expirationExpression !== undefined && { expirationExpression: this.expirationExpression }),
      authErrorCodes: this.authErrorCodes,
      deprecated: this.deprecated
    }
  }
}
