/**
 * Schema Configuration for Restorm
 *
 * Uses the GraphQL Schema Generator from electron-core-ui with decorated classes.
 * Custom queries/mutations/subscriptions are registered to match the resolvers.
 */

import { graphQLSchemaGenerator } from 'electron-core-ui/main'

import {
  KeyValue,
  Environment,
  Folder,
  EnvironmentFolder,
  HTTP_METHODS,
  REQUEST_TYPES,
  GRAPHQL_OPERATION_TYPES,
  GRPC_CALL_TYPES,
  WEBSOCKET_PROTOCOLS,
  HTTP_BODY_TYPES
} from '../../shared/models'

import {
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  ODataRequest,
  AuthenticationRequest
} from '../../shared/models/requests'

// =============================================================================
// Enum Registration
// =============================================================================

function registerEnums(): void {
  graphQLSchemaGenerator.registerEnum('HTTPMethod', [...HTTP_METHODS])
  graphQLSchemaGenerator.registerEnum('RequestType', [...REQUEST_TYPES])
  graphQLSchemaGenerator.registerEnum('GraphQLOperationType', [...GRAPHQL_OPERATION_TYPES])
  graphQLSchemaGenerator.registerEnum('GrpcCallType', [...GRPC_CALL_TYPES])
  graphQLSchemaGenerator.registerEnum('WebSocketProtocol', [...WEBSOCKET_PROTOCOLS])
  graphQLSchemaGenerator.registerEnum('HTTPBodyType', [...HTTP_BODY_TYPES])
}

// =============================================================================
// Class Registration (with decorators)
// =============================================================================

function registerClasses(): void {
  // All classes skip generic queries/mutations/subscriptions because we define them custom
  const skipGeneric = {
    skipGenericQueries: true,
    skipGenericMutations: true,
    skipGenericSubscriptions: true
  }

  // Register all classes using @graphqlField decorators
  graphQLSchemaGenerator.registerClassAuto(KeyValue, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(Environment, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(Folder, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(EnvironmentFolder, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(HTTPRequest, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(GraphQLRequest, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(GrpcRequest, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(SoapRequest, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(WebSocketRequest, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(ODataRequest, skipGeneric)
  graphQLSchemaGenerator.registerClassAuto(AuthenticationRequest, skipGeneric)
}

// =============================================================================
// Union Types
// =============================================================================

function registerUnions(): void {
  graphQLSchemaGenerator.registerUnion('Request', [
    'HTTPRequest', 'GraphQLRequest', 'GrpcRequest', 'SoapRequest', 'WebSocketRequest',
    'ODataRequest', 'AuthenticationRequest'
  ])

  graphQLSchemaGenerator.registerUnion('FolderItem', [
    'Folder', 'EnvironmentFolder', 'HTTPRequest', 'GraphQLRequest',
    'GrpcRequest', 'SoapRequest', 'WebSocketRequest', 'ODataRequest', 'AuthenticationRequest'
  ])
}

// =============================================================================
// Custom Types (not backed by classes)
// =============================================================================

function registerCustomTypes(): void {
  // Context resolution types
  graphQLSchemaGenerator.registerCustomType(`type ResolvedVariable {
  key: String!
  value: String!
  resolved: String!
}`)

  graphQLSchemaGenerator.registerCustomType(`type ResolvedContext {
  environmentId: String!
  variables: [ResolvedVariable!]!
}`)

  graphQLSchemaGenerator.registerCustomType(`type ResolvedURL {
  requestId: String!
  environmentId: String!
  original: String!
  resolved: String!
}`)

  // Search index update type
  graphQLSchemaGenerator.registerCustomType(`type SearchIndexUpdate {
  action: String!
  documentId: String!
  documentType: String!
}`)

  graphQLSchemaGenerator.registerCustomType(`type ResponseHistoryEntry {
  guid: String!
  success: Boolean!
  timestamp: String!
  pinned: Boolean!
}`)

  graphQLSchemaGenerator.registerCustomType(`type ResponseHistoryDetail {
  guid: String!
  requestId: String!
  type: String!
  success: Boolean!
  timestamp: String!
  pinned: Boolean!
  response: JSON!
  requestMeta: JSON
}`)
}

// =============================================================================
// Input Types (manually defined to match resolvers)
// =============================================================================

function registerInputTypes(): void {
  graphQLSchemaGenerator.registerCustomType(`input KeyValueInput {
  id: String
  key: String!
  value: String!
  description: String
  enabled: Boolean
}`)

  graphQLSchemaGenerator.registerCustomType(`input EnvironmentInput {
  id: String
  name: String!
  variables: [KeyValueInput!]!
  subEnvironments: [EnvironmentInput!]
}`)

  graphQLSchemaGenerator.registerCustomType(`input FolderInput {
  id: String
  name: String!
  documentation: String
  notes: String
  tags: [String!]
}`)

  graphQLSchemaGenerator.registerCustomType(`input HTTPRequestInput {
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
}`)
}

// =============================================================================
// Custom Queries (matching resolvers.ts)
// =============================================================================

function registerQueries(): void {
  // Collection queries
  graphQLSchemaGenerator.registerQuery('collections', '', '[EnvironmentFolder!]!')
  graphQLSchemaGenerator.registerQuery('folder', 'id: String!', 'Folder')
  graphQLSchemaGenerator.registerQuery('environmentFolder', 'id: String!', 'EnvironmentFolder')
  graphQLSchemaGenerator.registerQuery('request', 'id: String!', 'Request')
  graphQLSchemaGenerator.registerQuery('environment', 'id: String!', 'Environment')

  // Context queries
  graphQLSchemaGenerator.registerQuery('resolvedContext', 'environmentId: String!', 'ResolvedContext')
  graphQLSchemaGenerator.registerQuery('resolvedURL', 'requestId: String!, environmentId: String!', 'ResolvedURL')

  // Search query
  graphQLSchemaGenerator.registerQuery('search', 'query: String!, limit: Int', '[Request!]!')

  // Response history queries
  graphQLSchemaGenerator.registerQuery('responseHistoryList', 'requestId: String', '[ResponseHistoryEntry!]!')
  graphQLSchemaGenerator.registerQuery('responseHistoryDetail', 'guid: String!', 'ResponseHistoryDetail')
}

// =============================================================================
// Custom Mutations (matching resolvers.ts)
// =============================================================================

function registerMutations(): void {
  // Folder mutations
  graphQLSchemaGenerator.registerMutation('createFolder', 'parentId: String!, input: FolderInput!', 'Folder!')
  graphQLSchemaGenerator.registerMutation('updateFolder', 'id: String!, input: FolderInput!', 'Folder!')
  graphQLSchemaGenerator.registerMutation('deleteFolder', 'id: String!', 'Boolean!')
  graphQLSchemaGenerator.registerMutation('moveFolder', 'id: String!, newParentId: String!, index: Int!', 'Folder!')

  // Request mutations
  graphQLSchemaGenerator.registerMutation('createRequest', 'parentId: String!, input: HTTPRequestInput!', 'HTTPRequest!')
  graphQLSchemaGenerator.registerMutation('updateRequest', 'id: String!, input: HTTPRequestInput!', 'HTTPRequest!')
  graphQLSchemaGenerator.registerMutation('deleteRequest', 'id: String!', 'Boolean!')
  graphQLSchemaGenerator.registerMutation('moveRequest', 'id: String!, newParentId: String!, index: Int!', 'HTTPRequest!')

  // Environment mutations
  graphQLSchemaGenerator.registerMutation('createEnvironment', 'parentId: String!, input: EnvironmentInput!, parentEnvironmentId: String', 'Environment!')
  graphQLSchemaGenerator.registerMutation('updateEnvironment', 'id: String!, input: EnvironmentInput!', 'Environment!')
  graphQLSchemaGenerator.registerMutation('deleteEnvironment', 'id: String!', 'Boolean!')
}

// =============================================================================
// Custom Subscriptions (matching resolvers.ts)
// =============================================================================

function registerSubscriptions(): void {
  // Folder subscriptions
  graphQLSchemaGenerator.registerSubscription('folderCreated', '', 'Folder!')
  graphQLSchemaGenerator.registerSubscription('folderUpdated', '', 'Folder!')
  graphQLSchemaGenerator.registerSubscription('folderDeleted', '', 'String!')

  // Request subscriptions
  graphQLSchemaGenerator.registerSubscription('requestCreated', '', 'Request!')
  graphQLSchemaGenerator.registerSubscription('requestUpdated', '', 'Request!')
  graphQLSchemaGenerator.registerSubscription('requestDeleted', '', 'String!')

  // Environment subscriptions
  graphQLSchemaGenerator.registerSubscription('environmentCreated', '', 'Environment!')
  graphQLSchemaGenerator.registerSubscription('environmentUpdated', '', 'Environment!')
  graphQLSchemaGenerator.registerSubscription('environmentDeleted', '', 'String!')

  // Context subscription
  graphQLSchemaGenerator.registerSubscription('contextChanged', 'environmentId: String!', 'ResolvedContext!')

  // Search index subscription
  graphQLSchemaGenerator.registerSubscription('searchIndexUpdated', '', 'SearchIndexUpdate!')
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Generate the complete GraphQL schema for Restorm
 */
export function generateRestormSchema(): string {
  // Clear any previous registrations
  graphQLSchemaGenerator.clear()

  // Register everything
  registerEnums()
  registerClasses()
  registerUnions()
  registerCustomTypes()
  registerInputTypes()
  registerQueries()
  registerMutations()
  registerSubscriptions()

  // Generate and return the schema
  return graphQLSchemaGenerator.generateSchema()
}
