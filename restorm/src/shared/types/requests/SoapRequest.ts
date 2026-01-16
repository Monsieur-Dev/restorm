import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'

export interface SoapRequest extends BaseRequest {
  type: 'soap'
  url: string
  soapAction: string
  service: string
  operation: string
  body: string
  headers: KeyValue[]
}
