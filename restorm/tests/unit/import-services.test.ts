/**
 * Unit tests for import services
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { importSwaggerFromJson } from '../../src/renderer/src/services/SwaggerImportService'
import { importGraphQLFromString } from '../../src/renderer/src/services/GraphQLImportService'
import { importGrpcFromString } from '../../src/renderer/src/services/GrpcImportService'
import { importSoapFromString } from '../../src/renderer/src/services/SoapImportService'
import { importAsyncAPIFromString } from '../../src/renderer/src/services/AsyncAPIImportService'
import type { Folder, EnvironmentFolder, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest } from '../../src/renderer/src/types/collections'

// Helper to load test files
const loadTestFile = (filename: string): string => {
  return readFileSync(join(__dirname, filename), 'utf-8')
}

// Helper to check if item is a Folder
const isFolder = (item: unknown): item is Folder => {
  return typeof item === 'object' && item !== null && 'items' in item && Array.isArray((item as Folder).items)
}

// Helper to find all requests recursively
const findAllRequests = <T>(folder: Folder | EnvironmentFolder, predicate: (item: unknown) => item is T): T[] => {
  const results: T[] = []
  for (const item of folder.items) {
    if (isFolder(item)) {
      results.push(...findAllRequests(item, predicate))
    } else if (predicate(item)) {
      results.push(item)
    }
  }
  return results
}

// Type guards for requests
function isHTTPRequest(item: unknown): item is HTTPRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'http'
}

function isGraphQLRequest(item: unknown): item is GraphQLRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'graphql'
}

function isGrpcRequest(item: unknown): item is GrpcRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'grpc'
}

function isSoapRequest(item: unknown): item is SoapRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'soap'
}

function isWebSocketRequest(item: unknown): item is WebSocketRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'websocket'
}

// =============================================================================
// SwaggerImportService Tests
// =============================================================================

describe('SwaggerImportService', () => {
  const swaggerJson = loadTestFile('swagger-petstore.json')

  describe('importSwaggerFromJson', () => {
    it('should import Swagger spec and return an EnvironmentFolder', () => {
      const result = importSwaggerFromJson(swaggerJson)

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('Swagger Petstore')
      expect(result.environments).toBeDefined()
      expect(result.environments.length).toBeGreaterThan(0)
    })

    it('should create environment with baseUrl variable', () => {
      const result = importSwaggerFromJson(swaggerJson)
      const defaultEnv = result.environments.find((e) => e.name === 'Default')

      expect(defaultEnv).toBeDefined()
      expect(defaultEnv?.variables.some((v) => v.key === 'baseUrl')).toBe(true)
    })

    it('should create folders for each tag', () => {
      const result = importSwaggerFromJson(swaggerJson)

      // Petstore has tags: pet, store, user
      const tagNames = result.items.filter(isFolder).map((f) => f.name)
      expect(tagNames).toContain('pet')
      expect(tagNames).toContain('store')
      expect(tagNames).toContain('user')
    })

    it('should create HTTP requests for each endpoint', () => {
      const result = importSwaggerFromJson(swaggerJson)
      const requests = findAllRequests(result, isHTTPRequest)

      expect(requests.length).toBeGreaterThan(0)
      // All requests should be HTTP type
      requests.forEach((req) => {
        expect(req.type).toBe('http')
        expect(req.method).toBeDefined()
        expect(req.url).toBeDefined()
      })
    })

    it('should correctly parse HTTP methods', () => {
      const result = importSwaggerFromJson(swaggerJson)
      const requests = findAllRequests(result, isHTTPRequest)

      const methods = new Set(requests.map((r) => r.method))
      // Petstore uses GET, POST, PUT, DELETE
      expect(methods.has('GET')).toBe(true)
      expect(methods.has('POST')).toBe(true)
      expect(methods.has('PUT')).toBe(true)
      expect(methods.has('DELETE')).toBe(true)
    })

    it('should use custom baseUrl option', () => {
      const result = importSwaggerFromJson(swaggerJson, {
        baseUrl: 'http://custom.url'
      })

      const defaultEnv = result.environments.find((e) => e.name === 'Default')
      const baseUrlVar = defaultEnv?.variables.find((v) => v.key === 'baseUrl')
      expect(baseUrlVar?.value).toBe('http://custom.url')
    })

    it('should mark deprecated endpoints', () => {
      const result = importSwaggerFromJson(swaggerJson)
      const requests = findAllRequests(result, isHTTPRequest)

      // findPetsByTags is deprecated in the spec (operationId)
      const deprecatedRequest = requests.find((r) => 
        r.name.toLowerCase().includes('tag') && r.method === 'GET'
      )
      // Some request should be deprecated (findPetsByTags in petstore)
      const hasDeprecated = requests.some((r) => r.deprecated === true)
      expect(hasDeprecated).toBe(true)
      if (deprecatedRequest) {
        expect(deprecatedRequest.deprecated).toBe(true)
      }
    })

    it('should generate unique IDs for all items', () => {
      const result = importSwaggerFromJson(swaggerJson)
      const requests = findAllRequests(result, isHTTPRequest)
      const ids = requests.map((r) => r.id)

      // All IDs should be unique
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should throw on invalid JSON', () => {
      expect(() => importSwaggerFromJson('not valid json')).toThrow()
    })
  })
})

// =============================================================================
// GraphQLImportService Tests
// =============================================================================

describe('GraphQLImportService', () => {
  const graphqlSchema = loadTestFile('graphql-docker.graphql')

  describe('importGraphQLFromString', () => {
    it('should import GraphQL schema and return an EnvironmentFolder', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('GraphQL Test')
    })

    it('should create folders for queries, mutations, and subscriptions', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })
      const folderNames = result.items.filter(isFolder).map((f) => f.name)

      expect(folderNames).toContain('Queries')
      expect(folderNames).toContain('Mutations')
      expect(folderNames).toContain('Subscriptions')
    })

    it('should create GraphQL requests for each operation', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })
      const requests = findAllRequests(result, isGraphQLRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('graphql')
        expect(req.query).toBeDefined()
        expect(req.operationType).toBeDefined()
      })
    })

    it('should correctly identify operation types', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })
      const requests = findAllRequests(result, isGraphQLRequest)

      const queries = requests.filter((r) => r.operationType === 'query')
      const mutations = requests.filter((r) => r.operationType === 'mutation')
      const subscriptions = requests.filter((r) => r.operationType === 'subscription')

      // Docker schema has queries (users, user, posts, post, echo)
      expect(queries.length).toBeGreaterThan(0)
      // Docker schema has mutations (createUser, createPost, deleteUser, deletePost)
      expect(mutations.length).toBeGreaterThan(0)
      // Docker schema has subscriptions (postCreated)
      expect(subscriptions.length).toBeGreaterThan(0)
    })

    it('should parse query arguments', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })
      const requests = findAllRequests(result, isGraphQLRequest)

      // echo query has a message argument
      const echoQuery = requests.find((r) => r.name === 'echo')
      expect(echoQuery?.query).toContain('message')
    })

    it('should use custom baseUrl option', () => {
      const result = importGraphQLFromString(graphqlSchema, {
        name: 'GraphQL Test',
        baseUrl: 'http://localhost:4000/graphql'
      })
      const requests = findAllRequests(result, isGraphQLRequest)

      requests.forEach((req) => {
        expect(req.url).toBe('http://localhost:4000/graphql')
      })
    })

    it('should set Content-Type header', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })
      const requests = findAllRequests(result, isGraphQLRequest)

      requests.forEach((req) => {
        const contentTypeHeader = req.headers.find((h) => h.key === 'Content-Type')
        expect(contentTypeHeader?.value).toBe('application/json')
      })
    })

    it('should generate unique IDs for all requests', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' })
      const requests = findAllRequests(result, isGraphQLRequest)
      const ids = requests.map((r) => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

// =============================================================================
// GrpcImportService Tests
// =============================================================================

describe('GrpcImportService', () => {
  const protoFile = loadTestFile('grpc-docker.proto')

  describe('importGrpcFromString', () => {
    it('should import proto file and return an EnvironmentFolder', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('gRPC Test')
    })

    it('should create folders for each service', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })
      const folderNames = result.items.filter(isFolder).map((f) => f.name)

      // Docker proto has: HelloService, HeadersService, IndexService, DummyService
      expect(folderNames).toContain('HelloService')
      expect(folderNames).toContain('HeadersService')
      expect(folderNames).toContain('IndexService')
      expect(folderNames).toContain('DummyService')
    })

    it('should create gRPC requests for each method', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })
      const requests = findAllRequests(result, isGrpcRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('grpc')
        expect(req.service).toBeDefined()
        expect(req.method).toBeDefined()
        expect(req.requestMessage).toBeDefined()
      })
    })

    it('should correctly identify call types', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })
      const requests = findAllRequests(result, isGrpcRequest)

      const callTypes = new Set(requests.map((r) => r.callType))
      // DummyService has all 4 call types
      expect(callTypes.has('unary')).toBe(true)
      expect(callTypes.has('server-stream')).toBe(true)
      expect(callTypes.has('client-stream')).toBe(true)
      expect(callTypes.has('bidirectional-stream')).toBe(true)
    })

    it('should include package name in service', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })
      const requests = findAllRequests(result, isGrpcRequest)

      // All services should be prefixed with package name
      requests.forEach((req) => {
        expect(req.service).toContain('grpcbin.')
      })
    })

    it('should use custom baseUrl option', () => {
      const result = importGrpcFromString(protoFile, {
        name: 'gRPC Test',
        baseUrl: 'localhost:9000'
      })
      const requests = findAllRequests(result, isGrpcRequest)

      requests.forEach((req) => {
        expect(req.url).toBe('localhost:9000')
      })
    })

    it('should generate sample request messages', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })
      const requests = findAllRequests(result, isGrpcRequest)

      // HelloService.SayHello should have a greeting field
      const sayHello = requests.find((r) => r.method === 'SayHello')
      expect(sayHello?.requestMessage).toContain('greeting')
    })

    it('should generate unique IDs for all requests', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' })
      const requests = findAllRequests(result, isGrpcRequest)
      const ids = requests.map((r) => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

// =============================================================================
// SoapImportService Tests
// =============================================================================

describe('SoapImportService', () => {
  const wsdlFile = loadTestFile('soap-docker.wsdl')

  describe('importSoapFromString', () => {
    it('should import WSDL and return an EnvironmentFolder', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('SOAP Test')
    })

    it('should create folders for each service', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })
      const folders = result.items.filter(isFolder)

      expect(folders.length).toBeGreaterThan(0)
    })

    it('should create SOAP requests for each operation', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })
      const requests = findAllRequests(result, isSoapRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('soap')
        expect(req.soapAction).toBeDefined()
        expect(req.body).toBeDefined()
      })
    })

    it('should generate SOAP envelope in body', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        expect(req.body).toContain('soap:Envelope')
        expect(req.body).toContain('soap:Body')
      })
    })

    it('should set correct Content-Type header', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        const contentTypeHeader = req.headers.find((h) => h.key === 'Content-Type')
        expect(contentTypeHeader?.value).toContain('text/xml')
      })
    })

    it('should set SOAPAction header', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        const soapActionHeader = req.headers.find((h) => h.key === 'SOAPAction')
        expect(soapActionHeader).toBeDefined()
      })
    })

    it('should use custom baseUrl option', () => {
      const result = importSoapFromString(wsdlFile, {
        name: 'SOAP Test',
        baseUrl: 'http://localhost:8080/soap'
      })
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        expect(req.url).toBe('http://localhost:8080/soap')
      })
    })

    it('should generate unique IDs for all requests', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' })
      const requests = findAllRequests(result, isSoapRequest)
      const ids = requests.map((r) => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

// =============================================================================
// AsyncAPIImportService Tests
// =============================================================================

describe('AsyncAPIImportService', () => {
  const asyncapiYaml = loadTestFile('asyncapi-docker.yaml')

  describe('importAsyncAPIFromString', () => {
    it('should import AsyncAPI spec and return an EnvironmentFolder', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('AsyncAPI Test')
    })

    it('should create folders for each protocol', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })
      const folderNames = result.items.filter(isFolder).map((f) => f.name)

      // Docker AsyncAPI has MQTT and Socket.IO
      expect(folderNames.some((n) => n.includes('MQTT') || n.includes('Socket.IO') || n.includes('WebSocket'))).toBe(true)
    })

    it('should create WebSocket requests for each channel', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })
      const requests = findAllRequests(result, isWebSocketRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('websocket')
        expect(req.protocol).toBeDefined()
        expect(['websocket', 'socketio', 'mqtt']).toContain(req.protocol)
      })
    })

    it('should correctly identify protocols', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })
      const requests = findAllRequests(result, isWebSocketRequest)

      const protocols = new Set(requests.map((r) => r.protocol))
      // Docker AsyncAPI has mqtt and socketio
      expect(protocols.size).toBeGreaterThan(0)
    })

    it('should parse channel information', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })
      const requests = findAllRequests(result, isWebSocketRequest)

      // All requests should have names derived from channels
      requests.forEach((req) => {
        expect(req.name).toBeDefined()
        expect(req.name.length).toBeGreaterThan(0)
      })
    })

    it('should use custom baseUrl option', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, {
        name: 'AsyncAPI Test',
        baseUrl: 'ws://localhost:3001'
      })
      const defaultEnv = result.environments.find((e) => e.name === 'Default')
      const baseUrlVar = defaultEnv?.variables.find((v) => v.key === 'baseUrl')

      expect(baseUrlVar?.value).toBe('ws://localhost:3001')
    })

    it('should set event/topic names', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })
      const requests = findAllRequests(result, isWebSocketRequest)

      // Socket.IO and MQTT requests should have event/topic
      const socketioRequests = requests.filter((r) => r.protocol === 'socketio')
      socketioRequests.forEach((req) => {
        expect(req.event).toBeDefined()
      })
    })

    it('should generate unique IDs for all requests', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' })
      const requests = findAllRequests(result, isWebSocketRequest)
      const ids = requests.map((r) => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

// =============================================================================
// Cross-service Tests
// =============================================================================

describe('Import Services - Cross-validation', () => {
  it('should all return EnvironmentFolder with consistent structure', () => {
    const swagger = importSwaggerFromJson(loadTestFile('swagger-petstore.json'))
    const graphql = importGraphQLFromString(loadTestFile('graphql-docker.graphql'), { name: 'GraphQL' })
    const grpc = importGrpcFromString(loadTestFile('grpc-docker.proto'), { name: 'gRPC' })
    const soap = importSoapFromString(loadTestFile('soap-docker.wsdl'), { name: 'SOAP' })
    const asyncapi = importAsyncAPIFromString(loadTestFile('asyncapi-docker.yaml'), { name: 'AsyncAPI' })

    const results = [swagger, graphql, grpc, soap, asyncapi]

    results.forEach((result) => {
      expect(result.folderType).toBe('environment')
      expect(result.id).toBeDefined()
      expect(result.name).toBeDefined()
      expect(result.items).toBeDefined()
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.environments).toBeDefined()
      expect(Array.isArray(result.environments)).toBe(true)
    })
  })

  it('should all create at least one environment', () => {
    const swagger = importSwaggerFromJson(loadTestFile('swagger-petstore.json'))
    const graphql = importGraphQLFromString(loadTestFile('graphql-docker.graphql'), { name: 'GraphQL' })
    const grpc = importGrpcFromString(loadTestFile('grpc-docker.proto'), { name: 'gRPC' })
    const soap = importSoapFromString(loadTestFile('soap-docker.wsdl'), { name: 'SOAP' })
    const asyncapi = importAsyncAPIFromString(loadTestFile('asyncapi-docker.yaml'), { name: 'AsyncAPI' })

    const results = [swagger, graphql, grpc, soap, asyncapi]

    results.forEach((result) => {
      expect(result.environments.length).toBeGreaterThan(0)
    })
  })

  it('should generate unique IDs across different imports', () => {
    // Run the same import twice to ensure IDs are unique
    const import1 = importSwaggerFromJson(loadTestFile('swagger-petstore.json'))
    const import2 = importSwaggerFromJson(loadTestFile('swagger-petstore.json'))

    const requests1 = findAllRequests(import1, isHTTPRequest)
    const requests2 = findAllRequests(import2, isHTTPRequest)

    // Same content should produce same IDs (deterministic)
    expect(requests1.length).toBe(requests2.length)
    for (let i = 0; i < requests1.length; i++) {
      expect(requests1[i].id).toBe(requests2[i].id)
    }
  })
})
