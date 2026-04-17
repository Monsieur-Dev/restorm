/**
 * GraphQLRequest - GraphQL request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField
} from 'electron-core-ui/main'
import { BaseRequest } from './BaseRequest'
import { KeyValue } from '../KeyValue'
import type { GraphQLOperationType, RequestType, RuntimeId, Icon } from '../types'

/**
 * GraphQL request definition with operation type, query, and variables.
 */
@fileNaming({ pattern: '{index} - GRAPHQL - {name}', nameProperty: 'name', idProperty: 'id' })
export class GraphQLRequest extends BaseRequest {
  /** Request type discriminator */
  readonly type: RequestType = 'graphql'

  /** GraphQL endpoint URL */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1.5 })
  url = ''

  /** GraphQL operation type */
  @graphqlField({ type: 'GraphQLOperationType' })
  @searchable.property({ filterable: true })
  operationType: GraphQLOperationType = 'query'

  /** GraphQL query/mutation/subscription string */
  @graphqlField({ type: 'String' })
  @searchable.property({ weight: 1 })
  query = ''

  /** GraphQL variables as JSON string */
  @graphqlField({ type: 'String', nullable: true })
  variables?: string

  /** HTTP headers */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  constructor(init?: Partial<GraphQLRequest>) {
    super(init)
    if (init) {
      Object.assign(this, init)
      if (init.headers) {
        this.headers = init.headers.map(h =>
          h instanceof KeyValue ? h : KeyValue.fromPlain(h as unknown as Parameters<typeof KeyValue.fromPlain>[0])
        )
      }
    }
  }

  /**
   * Create a GraphQLRequest from a plain object
   */
  static fromPlain(obj: {
    id?: RuntimeId
    name?: string
    icon?: Icon
    documentation?: string
    notes?: string
    tags?: string[]
    url?: string
    operationType?: GraphQLOperationType
    query?: string
    variables?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
  }): GraphQLRequest {
    return new GraphQLRequest({
      id: obj.id,
      name: obj.name ?? '',
      icon: obj.icon,
      documentation: obj.documentation ?? '',
      notes: obj.notes,
      tags: obj.tags ?? [],
      url: obj.url ?? '',
      operationType: obj.operationType ?? 'query',
      query: obj.query ?? '',
      variables: obj.variables,
      headers: obj.headers as KeyValue[] | undefined
    })
  }

  /**
   * Create a plain object from this GraphQLRequest
   */
  toPlainObject(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      icon: this.icon,
      documentation: this.documentation,
      notes: this.notes,
      tags: this.tags,
      url: this.url,
      operationType: this.operationType,
      query: this.query,
      variables: this.variables,
      headers: this.headers.map(h => h.toPlainObject())
    }
  }
}
