import type { BaseResponse, HTTPTimings } from './BaseResponse'
import type { KeyValue } from '../baseTypes'

export interface GraphQLResponse extends BaseResponse {
  type: 'graphql'
  requestUrl: string
  requestQuery: string
  requestVariables?: string | undefined
  requestHeaders: KeyValue[]
  statusCode: number
  data?: unknown
  errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[] | undefined
  responseHeaders: KeyValue[]
  timings: HTTPTimings
}
