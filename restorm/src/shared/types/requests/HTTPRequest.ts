import type { BaseRequest } from './BaseRequest'
import type { HTTPRequestBody } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface HTTPRequest extends BaseRequest {
  type: 'http'
  method: string
  url: string
  headers: KeyValue[]
  params: KeyValue[]
  pathParams?: KeyValue[]
  body?: HTTPRequestBody
  deprecated?: boolean
  /** When true, restorm ACTS AS a local HTTP mock server: it listens on
   * `localhost:<port><path>` for this request's METHOD + PATH and answers with
   * the configured response (status/headers/body), instead of sending the
   * request as a client. The URL then carries only `localhost:<port><path>`
   * (host is fixed). */
  server?: boolean | undefined
  /** HTTP status code the mock serves (server mode; defaults to 200). */
  mockStatus?: number | undefined
  /** Per-request timeout in milliseconds; falls back to the global default. */
  timeout?: number
  /** Follow 3xx redirects on dispatch (defaults to true when unset). */
  followRedirects?: boolean
}
