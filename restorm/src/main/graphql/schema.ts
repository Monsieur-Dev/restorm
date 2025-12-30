/**
 * GraphQL Schema for Restorm
 * 
 * Defines the GraphQL schema for Restorm objects (Folder, Request, Environment, etc.)
 */

export const typeDefs = /* GraphQL */ `
  # ============================================================================
  # Enums
  # ============================================================================

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

  enum BodyType {
    none
    json
    text
    xml
    form
    graphql
    binary
    protobuf
  }

  enum GRPCCallType {
    unary
    serverStreaming
    clientStreaming
    bidirectional
  }

  enum GraphQLOperationType {
    query
    mutation
    subscription
  }

  # ============================================================================
  # Scalar Types
  # ============================================================================

  scalar JSON

  # ============================================================================
  # Input Types
  # ============================================================================

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

  input HTTPRequestInput {
    id: String
    name: String!
    type: RequestType!
    method: HTTPMethod!
    url: String!
    headers: [KeyValueInput!]
    params: [KeyValueInput!]
    pathParams: [KeyValueInput!]
    bodyType: BodyType
    body: String
    documentation: String
    notes: String
    tags: [String!]
  }

  input FolderInput {
    id: String
    name: String!
    documentation: String
    notes: String
    tags: [String!]
  }

  # ============================================================================
  # Object Types
  # ============================================================================

  type KeyValue {
    id: String!
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
    pathParams: [KeyValue!]!
    bodyType: BodyType
    body: String
    documentation: String
    notes: String
    tags: [String!]!
  }

  type GraphQLRequest {
    id: String!
    name: String!
    type: RequestType!
    url: String!
    headers: [KeyValue!]!
    operationType: GraphQLOperationType!
    query: String!
    variables: String
    documentation: String
    notes: String
    tags: [String!]!
  }

  type GrpcRequest {
    id: String!
    name: String!
    type: RequestType!
    url: String!
    metadata: [KeyValue!]!
    protoFile: String
    service: String!
    method: String!
    callType: GRPCCallType!
    requestMessage: String
    documentation: String
    notes: String
    tags: [String!]!
  }

  type SoapRequest {
    id: String!
    name: String!
    type: RequestType!
    url: String!
    headers: [KeyValue!]!
    service: String
    operation: String
    soapAction: String
    body: String
    documentation: String
    notes: String
    tags: [String!]!
  }

  type WebSocketRequest {
    id: String!
    name: String!
    type: RequestType!
    url: String!
    headers: [KeyValue!]!
    message: String
    documentation: String
    notes: String
    tags: [String!]!
  }

  union Request = HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest
  union FolderItem = Folder | EnvironmentFolder | HTTPRequest | GraphQLRequest | GrpcRequest | SoapRequest | WebSocketRequest

  # ============================================================================
  # Context Types
  # ============================================================================

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
  }

  # ============================================================================
  # Query Type
  # ============================================================================

  type Query {
    # Collections
    collections: [EnvironmentFolder!]!
    folder(id: String!): Folder
    environmentFolder(id: String!): EnvironmentFolder
    request(id: String!): Request
    environment(id: String!): Environment

    # Context resolution
    resolvedContext(environmentId: String!): ResolvedContext
    resolvedURL(requestId: String!, environmentId: String!): ResolvedURL

    # Search
    search(query: String!, limit: Int): [Request!]!
  }

  # ============================================================================
  # Mutation Type
  # ============================================================================

  type Mutation {
    # Folder operations
    createFolder(parentId: String!, input: FolderInput!): Folder!
    updateFolder(id: String!, input: FolderInput!): Folder!
    deleteFolder(id: String!): Boolean!
    moveFolder(id: String!, newParentId: String!, index: Int!): Folder!

    # Request operations
    createRequest(parentId: String!, input: HTTPRequestInput!): HTTPRequest!
    updateRequest(id: String!, input: HTTPRequestInput!): HTTPRequest!
    deleteRequest(id: String!): Boolean!
    moveRequest(id: String!, newParentId: String!, index: Int!): HTTPRequest!

    # Environment operations
    createEnvironment(parentId: String!, input: EnvironmentInput!): Environment!
    updateEnvironment(id: String!, input: EnvironmentInput!): Environment!
    deleteEnvironment(id: String!): Boolean!
  }

  # ============================================================================
  # Subscription Type
  # ============================================================================

  type Subscription {
    # Document events
    folderCreated: Folder!
    folderUpdated: Folder!
    folderDeleted: String!

    requestCreated: Request!
    requestUpdated: Request!
    requestDeleted: String!

    environmentCreated: Environment!
    environmentUpdated: Environment!
    environmentDeleted: String!

    # Context events
    contextChanged(environmentId: String!): ResolvedContext!
  }
`
