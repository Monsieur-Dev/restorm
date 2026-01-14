import type { BaseResponse, HTTPTimings, HTTPNetworkInfo } from './BaseResponse'
import type { HTTPMethod, HTTPRequestBody } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface HTTPResponse extends BaseResponse {
  type: 'http'
  requestUrl: string
  requestMethod: HTTPMethod
  requestHeaders: KeyValue[]
  requestParams: KeyValue[]
  requestPathParams?: KeyValue[]
  requestBody?: HTTPRequestBody
  statusCode: number
  statusText: string
  responseHeaders: KeyValue[]
  responseBody: string
  contentType?: string
  contentLength?: number
  timings: HTTPTimings
  network?: HTTPNetworkInfo
  referrerPolicy?: string
}
