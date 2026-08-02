/**
 * GraphQLRequest - GraphQL request definition
 */

import {
  searchable,
  fileNaming,
  graphqlField,
  TreatEmptyAsUndefined
} from 'electron-core-ui/decorators'
import { BaseRequest } from './BaseRequest'
import { pickImportMarkers, type ImportMarkerFields } from './importMarkers'
import { KeyValue } from '../KeyValue'
import type { GraphQLOperationType, RequestType, RuntimeId, Icon } from '../types'
import type { QuickConfig } from '../../types/requests/QuickConfig'

/**
 * GraphQL request definition with operation type, query, and variables.
 */
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name', idProperty: 'id' })
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
  @TreatEmptyAsUndefined()
  query = ''

  /** GraphQL variables as JSON string */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  variables?: string

  /**
   * Selected operation name when the query document declares more than
   * one named operation. Undefined for single-operation documents.
   */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  operationName?: string

  /** HTTP headers */
  @graphqlField({ type: 'KeyValue', isArray: true })
  headers: KeyValue[] = []

  /** When true, restorm ACTS AS a local GraphQL mock server: it hosts a GraphQL
   * endpoint on `localhost:<port><path>` resolving operations from the
   * configured SDL + resolvers, instead of sending the request as a client. The
   * URL then carries only `localhost:<port><path>` (host is fixed). */
  @graphqlField({ type: 'Boolean', nullable: true })
  @TreatEmptyAsUndefined()
  server?: boolean

  /** SDL schema served in server mode (the `typeDefs` passed to the mock). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  schema?: string

  /** Per-field canned response values served in server mode: a JSON object
   * keyed by `Type.field` (e.g. `Query.pets`). */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  mockResolvers?: string

  /** Optional scripted resolver (a JavaScript code-node body) computing the
   * response from `(parent, args, context)` in server mode. */
  @graphqlField({ type: 'String', nullable: true })
  @TreatEmptyAsUndefined()
  resolverScript?: string

  /** User-saved quick-config snapshots for this request. */
  quickConfigs?: QuickConfig[]

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
    authenticationRequestId?: RuntimeId
    url?: string
    operationType?: GraphQLOperationType
    query?: string
    variables?: string
    operationName?: string
    headers?: Parameters<typeof KeyValue.fromPlain>[0][]
    server?: boolean
    schema?: string
    mockResolvers?: string
    resolverScript?: string
    quickConfigs?: QuickConfig[]
  } & ImportMarkerFields): GraphQLRequest {
    return new GraphQLRequest({
      ...(obj.id !== undefined && { id: obj.id }),
      name: obj.name ?? '',
      ...(obj.icon !== undefined && { icon: obj.icon }),
      documentation: obj.documentation ?? '',
      ...(obj.notes !== undefined && { notes: obj.notes }),
      tags: obj.tags ?? [],
      ...(obj.authenticationRequestId !== undefined && { authenticationRequestId: obj.authenticationRequestId }),
      ...pickImportMarkers(obj),
      url: obj.url ?? '',
      operationType: obj.operationType ?? 'query',
      query: obj.query ?? '',
      ...(obj.variables !== undefined && { variables: obj.variables }),
      ...(obj.operationName !== undefined && { operationName: obj.operationName }),
      headers: (obj.headers ?? []) as KeyValue[],
      ...(obj.server !== undefined && { server: obj.server }),
      ...(obj.schema !== undefined && { schema: obj.schema }),
      ...(obj.mockResolvers !== undefined && { mockResolvers: obj.mockResolvers }),
      ...(obj.resolverScript !== undefined && { resolverScript: obj.resolverScript }),
      ...(obj.quickConfigs !== undefined && { quickConfigs: obj.quickConfigs })
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
      ...(this.authenticationRequestId !== undefined && { authenticationRequestId: this.authenticationRequestId }),
      ...pickImportMarkers(this),
      url: this.url,
      operationType: this.operationType,
      query: this.query,
      variables: this.variables,
      ...(this.operationName !== undefined && { operationName: this.operationName }),
      headers: this.headers.map(h => h.toPlainObject()),
      ...(this.server !== undefined && { server: this.server }),
      ...(this.schema !== undefined && { schema: this.schema }),
      ...(this.mockResolvers !== undefined && { mockResolvers: this.mockResolvers }),
      ...(this.resolverScript !== undefined && { resolverScript: this.resolverScript }),
      ...(this.quickConfigs !== undefined && this.quickConfigs.length > 0 && { quickConfigs: this.quickConfigs })
    }
  }
}
