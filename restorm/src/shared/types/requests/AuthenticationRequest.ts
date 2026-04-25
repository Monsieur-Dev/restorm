import type { BaseRequest } from './BaseRequest'
import type { HTTPMethod, HTTPRequestBody } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

/**
 * Authentication request — an HTTP request whose sole purpose is to
 * fetch a token (or equivalent). Other requests reference it via
 * `BaseRequest.authenticationRequestId` and inherit its produced
 * headers at dispatch time.
 *
 * The type mirrors `HTTPRequest` (it IS an HTTP request in every way
 * that matters to the execution engine), plus three fields that drive
 * the auth-specific behaviour.
 */
export interface AuthenticationRequest extends BaseRequest {
  type: 'auth'
  method: HTTPMethod
  url: string
  headers: KeyValue[]
  params: KeyValue[]
  pathParams?: KeyValue[]
  body?: HTTPRequestBody

  /** Headers to inject into every request that references this auth
   * route. `value` is a Handlebars expression evaluated against the
   * last response body (e.g. `{{token_type}} {{access_token}}`). */
  producedHeaders: KeyValue[]

  /** Handlebars expression evaluated against the response body that
   * yields the number of seconds after which cached headers are
   * considered stale. Empty / absent = never auto-expire (only the
   * auth-error-code path triggers a refresh). */
  expirationExpression?: string

  /** HTTP status codes on downstream requests that trigger an auth
   * refresh + one automatic retry. Defaults to `[401, 403]`. */
  authErrorCodes: number[]

  deprecated?: boolean
}
