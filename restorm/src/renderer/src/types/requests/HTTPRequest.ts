import type { BaseRequest } from './BaseRequest'
import type { HTTPMethod, HTTPRequestBody } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface HTTPRequest extends BaseRequest {
  type: 'http'
  method: HTTPMethod
  url: string
  headers: KeyValue[]
  params: KeyValue[]
  pathParams?: KeyValue[]
  body?: HTTPRequestBody
  deprecated?: boolean
}
