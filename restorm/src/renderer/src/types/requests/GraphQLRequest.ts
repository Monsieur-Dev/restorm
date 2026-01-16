import type { BaseRequest } from './BaseRequest'
import type { GraphQLOperationType } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface GraphQLRequest extends BaseRequest {
  type: 'graphql'
  url: string
  operationType: GraphQLOperationType
  query: string
  variables?: string
  headers: KeyValue[]
}
