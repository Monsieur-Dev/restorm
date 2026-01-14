import type { BaseResponse, HTTPTimings } from './BaseResponse'
import type { KeyValue } from '../baseTypes'

export interface SoapResponse extends BaseResponse {
  type: 'soap'
  requestUrl: string
  requestSoapAction: string
  requestBody: string
  requestHeaders: KeyValue[]
  statusCode: number
  responseBody: string
  responseHeaders: KeyValue[]
  fault?: { code: string; message: string } | undefined
  timings: HTTPTimings
}
