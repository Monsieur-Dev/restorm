import type { BaseResponse, HTTPTimings, HTTPNetworkInfo } from './BaseResponse'
import type { HTTPMethod, HTTPRequestBody } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface HTTPResponse extends BaseResponse {
  type: 'http'
  requestUrl: string
  requestMethod: HTTPMethod
  requestHeaders: KeyValue[]
  requestParams: KeyValue[]
  requestPathParams?: KeyValue[] | undefined
  requestBody?: HTTPRequestBody | undefined
  statusCode: number
  statusText: string
  responseHeaders: KeyValue[]
  responseBody: string
  /** When true, `responseBody` is a base64-encoded binary payload
   * (the response was detected as non-text). The panel offers a
   * download instead of rendering the bytes as corrupting text. */
  bodyIsBase64?: boolean | undefined
  contentType?: string | undefined
  contentLength?: number | undefined
  timings: HTTPTimings
  network?: HTTPNetworkInfo | undefined
  referrerPolicy?: string | undefined
}
