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
  contentType?: string | undefined
  contentLength?: number | undefined
  timings: HTTPTimings
  network?: HTTPNetworkInfo | undefined
  referrerPolicy?: string | undefined
}
