/**
 * Schema Configuration for Restorm
 *
 * Registers all Restorm model classes with the GraphQL schema generator.
 * The schema is then auto-generated based on decorator metadata.
 */

import {
  graphQLSchemaGenerator,
  createFieldDefinitions
} from 'electron-core-ui/main'

import {
  KeyValue,
  Environment,
  Folder,
  EnvironmentFolder,
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest
} from '../../shared/models'

/**
 * Register all enums used in the schema
 */
function registerEnums(): void {
  graphQLSchemaGenerator.registerEnum('HTTPMethod', [
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'
  ])

  graphQLSchemaGenerator.registerEnum('RequestType', [
    'http', 'graphql', 'grpc', 'soap', 'websocket'
  ])

  graphQLSchemaGenerator.registerEnum('GraphQLOperationType', [
    'query', 'mutation', 'subscription'
  ])

  graphQLSchemaGenerator.registerEnum('GrpcCallType', [
    'unary', 'serverStreaming', 'clientStreaming', 'bidirectional'
  ])

  graphQLSchemaGenerator.registerEnum('WebSocketProtocol', [
    'websocket', 'socketio', 'mqtt'
  ])

  graphQLSchemaGenerator.registerEnum('HTTPBodyType', [
    'text', 'file', 'formData', 'xWwwFormUrlEncoded'
  ])
}

/**
 * Register all model classes with field definitions
 */
function registerClasses(): void {
  // KeyValue
  graphQLSchemaGenerator.registerClass(
    KeyValue,
    'KeyValue',
    createFieldDefinitions(KeyValue.prototype, {
      id: { type: 'String', nullable: true },
      key: { type: 'String' },
      value: { type: 'String' },
      description: { type: 'String', nullable: true },
      enabled: { type: 'Boolean', nullable: true }
    })
  )

  // Environment
  graphQLSchemaGenerator.registerClass(
    Environment,
    'Environment',
    createFieldDefinitions(Environment.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      variables: { type: 'KeyValue', isArray: true },
      subEnvironments: { type: 'Environment', isArray: true, nullable: true }
    })
  )

  // Folder
  graphQLSchemaGenerator.registerClass(
    Folder,
    'Folder',
    createFieldDefinitions(Folder.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true },
      items: { type: 'FolderItem', isArray: true }
    })
  )

  // EnvironmentFolder
  graphQLSchemaGenerator.registerClass(
    EnvironmentFolder,
    'EnvironmentFolder',
    createFieldDefinitions(EnvironmentFolder.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      folderType: { type: 'String' },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true },
      environments: { type: 'Environment', isArray: true },
      items: { type: 'FolderItem', isArray: true }
    })
  )

  // HTTPRequest
  graphQLSchemaGenerator.registerClass(
    HTTPRequest,
    'HTTPRequest',
    createFieldDefinitions(HTTPRequest.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      type: { type: 'RequestType' },
      method: { type: 'HTTPMethod' },
      url: { type: 'String' },
      headers: { type: 'KeyValue', isArray: true },
      params: { type: 'KeyValue', isArray: true },
      pathParams: { type: 'KeyValue', isArray: true, nullable: true },
      body: { type: 'JSON', nullable: true },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true },
      deprecated: { type: 'Boolean', nullable: true }
    })
  )

  // GraphQLRequest
  graphQLSchemaGenerator.registerClass(
    GraphQLRequest,
    'GraphQLRequest',
    createFieldDefinitions(GraphQLRequest.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      type: { type: 'RequestType' },
      url: { type: 'String' },
      operationType: { type: 'GraphQLOperationType' },
      query: { type: 'String' },
      variables: { type: 'String', nullable: true },
      headers: { type: 'KeyValue', isArray: true },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true }
    })
  )

  // GrpcRequest
  graphQLSchemaGenerator.registerClass(
    GrpcRequest,
    'GrpcRequest',
    createFieldDefinitions(GrpcRequest.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      type: { type: 'RequestType' },
      url: { type: 'String' },
      service: { type: 'String' },
      method: { type: 'String' },
      callType: { type: 'GrpcCallType' },
      requestMessage: { type: 'String', nullable: true },
      metadata: { type: 'KeyValue', isArray: true },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true }
    })
  )

  // SoapRequest
  graphQLSchemaGenerator.registerClass(
    SoapRequest,
    'SoapRequest',
    createFieldDefinitions(SoapRequest.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      type: { type: 'RequestType' },
      url: { type: 'String' },
      soapAction: { type: 'String', nullable: true },
      service: { type: 'String', nullable: true },
      operation: { type: 'String', nullable: true },
      body: { type: 'String', nullable: true },
      headers: { type: 'KeyValue', isArray: true },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true }
    })
  )

  // WebSocketRequest
  graphQLSchemaGenerator.registerClass(
    WebSocketRequest,
    'WebSocketRequest',
    createFieldDefinitions(WebSocketRequest.prototype, {
      id: { type: 'String' },
      name: { type: 'String' },
      type: { type: 'RequestType' },
      url: { type: 'String' },
      protocol: { type: 'WebSocketProtocol' },
      event: { type: 'String', nullable: true },
      message: { type: 'String', nullable: true },
      headers: { type: 'KeyValue', isArray: true },
      documentation: { type: 'String', nullable: true },
      notes: { type: 'String', nullable: true },
      tags: { type: 'String', isArray: true }
    })
  )
}

/**
 * Register union types
 */
function registerUnions(): void {
  graphQLSchemaGenerator.registerUnion('Request', [
    'HTTPRequest', 'GraphQLRequest', 'GrpcRequest', 'SoapRequest', 'WebSocketRequest'
  ])

  graphQLSchemaGenerator.registerUnion('FolderItem', [
    'Folder', 'EnvironmentFolder', 'HTTPRequest', 'GraphQLRequest', 'GrpcRequest', 'SoapRequest', 'WebSocketRequest'
  ])
}

/**
 * Initialize the schema configuration
 */
export function initializeSchemaConfig(): void {
  graphQLSchemaGenerator.clear()
  registerEnums()
  registerClasses()
  registerUnions()
}

/**
 * Generate the GraphQL schema string
 */
export function generateRestormSchema(): string {
  initializeSchemaConfig()

  // Generate base schema
  const baseSchema = graphQLSchemaGenerator.generateSchema()

  // Add SearchResult type
  const searchResultType = graphQLSchemaGenerator.generateSearchResultType()

  // Add context types (specific to Restorm)
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

  return `${baseSchema}\n\n${searchResultType}\n${contextTypes}`
}
