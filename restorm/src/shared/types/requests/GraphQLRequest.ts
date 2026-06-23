import type { BaseRequest } from './BaseRequest'
import type { GraphQLOperationType } from '../requestPrimitives'
import type { KeyValue } from '../baseTypes'

export interface GraphQLRequest extends BaseRequest {
  type: 'graphql'
  url: string
  operationType: GraphQLOperationType
  query: string
  variables?: string
  /**
   * Selected operation to execute when the query document declares more
   * than one named operation (GraphQL-over-HTTP requires `operationName`
   * in that case). Undefined when the document has a single operation.
   */
  operationName?: string
  headers: KeyValue[]
  /** When true, restorm ACTS AS a local GraphQL mock server: it hosts a GraphQL
   * endpoint on `localhost:<port><path>` that resolves operations from the
   * configured SDL + resolvers, instead of sending the request as a client. The
   * URL then carries only `localhost:<port><path>` (host is fixed). */
  server?: boolean | undefined
  /** SDL schema served in server mode (the `typeDefs` passed to the mock). */
  schema?: string | undefined
  /** Per-field canned response values served in server mode: a JSON object
   * keyed by `Type.field` (e.g. `Query.pets`). A field absent from this map
   * resolves to graphql-yoga's default. */
  mockResolvers?: string | undefined
  /** Optional scripted resolver (a JavaScript code-node body) computing the
   * response from `(parent, args, context)` in server mode; overrides the canned
   * value for the fields it returns. */
  resolverScript?: string | undefined
}
