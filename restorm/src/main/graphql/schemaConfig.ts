/**
 * Schema Configuration for Restorm
 *
 * Defines the GraphQL schema for Restorm.
 */

/**
 * Generate the GraphQL schema string
 */
export function generateRestormSchema(): string {

  // Generate base types (scalars, enums, objects, unions, inputs)
  // but NOT Query/Mutation/Subscription (we define those manually)
  const parts: string[] = []

  // Scalars
  parts.push('scalar JSON')

  // Enums
  const enums = `
enum HTTPMethod {
  GET
  POST
  PUT
  PATCH
  DELETE
  HEAD
  OPTIONS
}

enum RequestType {
  http
  graphql
  grpc
  soap
  websocket
}

enum GraphQLOperationType {
  query
  mutation
  subscription
}

enum GrpcCallType {
  unary
  serverStreaming
  clientStreaming
  bidirectional
}

enum WebSocketProtocol {
  websocket
  socketio
  mqtt
}

enum HTTPBodyType {
  text
  file
  formData
  xWwwFormUrlEncoded
}`
  parts.push(enums)

  // Object types
  const objectTypes = `
type KeyValue {
  id: String
  key: String!
  value: String!
  description: String
  enabled: Boolean
}

type Environment {
  id: String!
  name: String!
  variables: [KeyValue!]!
  subEnvironments: [Environment!]
}

type EnvironmentFolder {
  id: String!
  name: String!
  folderType: String!
  documentation: String
  notes: String
  tags: [String!]!
  environments: [Environment!]!
  items: [FolderItem!]!
}

type Folder {
  id: String!
  name: String!
  documentation: String
  notes: String
  tags: [String!]!
  configuration: JSON
  items: [FolderItem!]!
}

type HTTPRequest {
  id: String!
  name: String!
  type: RequestType!
  method: HTTPMethod!
  url: String!
  headers: [KeyValue!]!
  params: [KeyValue!]!
  pathParams: [KeyValue!]
  body: JSON
  documentation: String
  notes: String
  tags: [String!]!
  deprecated: Boolean
}

type GraphQLRequest {
  id: String!
  name: String!
  type: RequestType!
  url: String!
  operationType: GraphQLOperationType!
  query: String!
  variables: String
  headers: [KeyValue!]!
  documentation: String
  notes: String
  tags: [String!]!
}

type GrpcRequest {
  id: String!
  name: String!
  type: RequestType!
  url: String!
  service: String!
  method: String!
  callType: GrpcCallType!
  requestMessage: String
  metadata: [KeyValue!]!
  documentation: String
  notes: String
  tags: [String!]!
}

type SoapRequest {
  id: String!
  name: String!
  type: RequestType!
  url: String!
  soapAction: String
  service: String
  operation: String
  body: String
  headers: [KeyValue!]!
  documentation: String
  notes: String
  tags: [String!]!
}

type WebSocketRequest {
  id: String!
  name: String!
  type: RequestType!
  url: String!
  protocol: WebSocketProtocol!
  event: String
  message: String
  headers: [KeyValue!]!
  documentation: String
  notes: String
  tags: [String!]!
}`
  parts.push(objectTypes)

  // Union types
  parts.push('union Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest')
  parts.push('union FolderItem = Folder | EnvironmentFolder | HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest')

  // Input types
  const inputTypes = `
input KeyValueInput {
  id: String
  key: String!
  value: String!
  description: String
  enabled: Boolean
}

input EnvironmentInput {
  id: String
  name: String!
  variables: [KeyValueInput!]!
  subEnvironments: [EnvironmentInput!]
}

input FolderInput {
  id: String
  name: String!
  documentation: String
  notes: String
  tags: [String!]
}

input HTTPRequestInput {
  id: String
  name: String!
  type: RequestType!
  method: HTTPMethod!
  url: String!
  headers: [KeyValueInput!]
  params: [KeyValueInput!]
  pathParams: [KeyValueInput!]
  body: JSON
  documentation: String
  notes: String
  tags: [String!]
}`
  parts.push(inputTypes)

  // Context types
  const contextTypes = `
type ResolvedVariable {
  key: String!
  value: String!
  resolved: String!
}

type ResolvedContext {
  environmentId: String!
  variables: [ResolvedVariable!]!
}

type ResolvedURL {
  requestId: String!
  environmentId: String!
  original: String!
  resolved: String!
}`
  parts.push(contextTypes)

  // Query type (matches resolvers.ts)
  const queryType = `
type Query {
  collections: [EnvironmentFolder!]!
  folder(id: String!): Folder
  environmentFolder(id: String!): EnvironmentFolder
  request(id: String!): Request
  environment(id: String!): Environment
  resolvedContext(environmentId: String!): ResolvedContext
  resolvedURL(requestId: String!, environmentId: String!): ResolvedURL
  search(query: String!, limit: Int): [Request!]!
}`
  parts.push(queryType)

  // Mutation type (matches resolvers.ts)
  const mutationType = `
type Mutation {
  createFolder(parentId: String!, input: FolderInput!): Folder!
  updateFolder(id: String!, input: FolderInput!): Folder!
  deleteFolder(id: String!): Boolean!
  moveFolder(id: String!, newParentId: String!, index: Int!): Folder!
  createRequest(parentId: String!, input: HTTPRequestInput!): HTTPRequest!
  updateRequest(id: String!, input: HTTPRequestInput!): HTTPRequest!
  deleteRequest(id: String!): Boolean!
  moveRequest(id: String!, newParentId: String!, index: Int!): HTTPRequest!
  createEnvironment(parentId: String!, input: EnvironmentInput!): Environment!
  updateEnvironment(id: String!, input: EnvironmentInput!): Environment!
  deleteEnvironment(id: String!): Boolean!
}`
  parts.push(mutationType)

  // Subscription type (matches resolvers.ts)
  const subscriptionType = `
type Subscription {
  folderCreated: Folder!
  folderUpdated: Folder!
  folderDeleted: String!
  requestCreated: Request!
  requestUpdated: Request!
  requestDeleted: String!
  environmentCreated: Environment!
  environmentUpdated: Environment!
  environmentDeleted: String!
  contextChanged(environmentId: String!): ResolvedContext!
}`
  parts.push(subscriptionType)

  return parts.join('\n\n')
}
