import type { BaseResponse, HTTPTimings } from './BaseResponse'
import type { KeyValue } from '../baseTypes'

export interface GrpcResponse extends BaseResponse {
  type: 'grpc'
  requestUrl: string
  requestMethod: string
  requestMessage: string
  requestMetadata: KeyValue[]
  statusCode: number
  statusMessage: string
  responseMessage: string
  responseMetadata: KeyValue[]
  timings: HTTPTimings
}
