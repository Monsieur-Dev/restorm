import type { BaseRequest } from './BaseRequest'
import type { GrpcCallType } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface GrpcRequest extends BaseRequest {
  type: 'grpc'
  url: string
  service: string
  method: string
  callType: GrpcCallType
  requestMessage: string
  metadata: KeyValue[]
}
