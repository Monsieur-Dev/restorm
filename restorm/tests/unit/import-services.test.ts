/**
 * Unit tests for import services
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { importSwaggerFromJson } from '../../src/main/services/import/SwaggerImportService'
import { importGraphQLFromString } from '../../src/main/services/import/GraphQLImportService'
import { importGrpcFromString } from '../../src/main/services/import/GrpcImportService'
import { importSoapFromString } from '../../src/main/services/import/SoapImportService'
import { importAsyncAPIFromString } from '../../src/main/services/import/AsyncAPIImportService'
import { importPostmanFromJson } from '../../src/main/services/import/PostmanImportService'
import { importInsomniaFromJson } from '../../src/main/services/import/InsomniaImportService'
import { importBrunoFromJson } from '../../src/main/services/import/BrunoImportService'
import { importCurl } from '../../src/main/services/import/CurlImportService'
import { importPowerShell } from '../../src/main/services/import/PowerShellImportService'
import { importRestClient } from '../../src/main/services/import/RestClientImportService'
import { CURRENT_FILE_FORMAT_VERSION } from '../../src/shared/config/fileFormatVersion'
import type { Folder, EnvironmentFolder, HTTPRequest, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest } from '../../src/shared/types/collections'

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
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('Swagger Petstore')
      expect(result.environments).toBeDefined()
      expect(result.environments.length).toBeGreaterThan(0)
    })

    it('should create a structured environment with scheme/host/port/baseRoute/baseUrl on the root and only non-default scheme sub-envs', () => {
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder
      // Environment name is extracted from the host (localhost:8080 -> localhost)
      const env = result.environments.find((e) => e.name === 'localhost')
      expect(env).toBeDefined()

      // Root vars include structural parts AND the composed baseUrl expression
      const rootKeys = env?.variables.map((v) => v.key) ?? []
      expect(rootKeys).toContain('scheme')
      expect(rootKeys).toContain('host')
      expect(rootKeys).toContain('port')
      expect(rootKeys).toContain('baseRoute')
      expect(rootKeys).toContain('baseUrl')

      const baseUrlVar = env?.variables.find((v) => v.key === 'baseUrl')
      expect(baseUrlVar?.value.toString()).toBe('{{scheme}}://{{host}}:{{port}}{{baseRoute}}')

      // Localhost defaults to http, so the http sub-env is redundant and filtered out.
      // Only https (non-default) should remain.
      const subEnvs = env?.subEnvironments ?? []
      expect(subEnvs.length).toBe(1)
      expect(subEnvs[0]?.name).toBe('https')
    })

    it('should create folders for each tag', () => {
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder

      // Petstore has tags: pet, store, user
      const tagNames = result.items.filter(isFolder).map((f) => f.name)
      expect(tagNames).toContain('pet')
      expect(tagNames).toContain('store')
      expect(tagNames).toContain('user')
    })

    it('should create HTTP requests for each endpoint', () => {
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder
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
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder
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
      }) as EnvironmentFolder

      // Environment name is extracted from the host (localhost:8080 -> localhost)
      const env = result.environments.find((e) => e.name === 'localhost')
      const baseUrlVar = env?.variables.find((v) => v.key === 'baseUrl')
      expect(baseUrlVar?.value.toString()).toBe('http://custom.url')
    })

    it('should mark deprecated endpoints', () => {
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder
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
      const result = importSwaggerFromJson(swaggerJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)
      const ids = requests.map((r) => r.id)

      // All IDs should be unique
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should throw on invalid JSON', () => {
      expect(() => { importSwaggerFromJson('not valid json') }).toThrow()
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
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('GraphQL Test')
    })

    it('should create folders for queries, mutations, and subscriptions', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder
      const folderNames = result.items.filter(isFolder).map((f) => f.name)

      expect(folderNames).toContain('Queries')
      expect(folderNames).toContain('Mutations')
      expect(folderNames).toContain('Subscriptions')
    })

    it('should create GraphQL requests for each operation', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isGraphQLRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('graphql')
        expect(req.query).toBeDefined()
        expect(req.operationType).toBeDefined()
      })
    })

    it('should correctly identify operation types', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder
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
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isGraphQLRequest)

      // echo query has a message argument
      const echoQuery = requests.find((r) => r.name === 'echo')
      expect(echoQuery?.query).toContain('message')
    })

    it('should use custom baseUrl option', () => {
      const result = importGraphQLFromString(graphqlSchema, {
        name: 'GraphQL Test',
        baseUrl: 'http://localhost:4000/graphql'
      }) as EnvironmentFolder
      const requests = findAllRequests(result, isGraphQLRequest)

      requests.forEach((req) => {
        expect(req.url).toBe('http://localhost:4000/graphql')
      })
    })

    it('should set Content-Type header', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isGraphQLRequest)

      requests.forEach((req) => {
        const contentTypeHeader = req.headers.find((h) => h.key === 'Content-Type')
        expect(contentTypeHeader?.value.toString()).toBe('application/json')
      })
    })

    it('should generate unique IDs for all requests', () => {
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL Test' }) as EnvironmentFolder
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
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('gRPC Test')
    })

    it('should create folders for each service', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder
      const folderNames = result.items.filter(isFolder).map((f) => f.name)

      // Docker proto has: HelloService, HeadersService, IndexService, DummyService
      expect(folderNames).toContain('HelloService')
      expect(folderNames).toContain('HeadersService')
      expect(folderNames).toContain('IndexService')
      expect(folderNames).toContain('DummyService')
    })

    it('should create gRPC requests for each method', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder
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
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isGrpcRequest)

      const callTypes = new Set(requests.map((r) => r.callType))
      // DummyService has all 4 call types
      expect(callTypes.has('unary')).toBe(true)
      expect(callTypes.has('server-stream')).toBe(true)
      expect(callTypes.has('client-stream')).toBe(true)
      expect(callTypes.has('bidirectional-stream')).toBe(true)
    })

    it('should include package name in service', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder
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
      }) as EnvironmentFolder
      const requests = findAllRequests(result, isGrpcRequest)

      requests.forEach((req) => {
        expect(req.url).toBe('localhost:9000')
      })
    })

    it('should generate sample request messages', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isGrpcRequest)

      // HelloService.SayHello should have a greeting field
      const sayHello = requests.find((r) => r.method === 'SayHello')
      expect(sayHello?.requestMessage).toContain('greeting')
    })

    it('should generate unique IDs for all requests', () => {
      const result = importGrpcFromString(protoFile, { name: 'gRPC Test' }) as EnvironmentFolder
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
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('SOAP Test')
    })

    it('should create folders for each service', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder
      const folders = result.items.filter(isFolder)

      expect(folders.length).toBeGreaterThan(0)
    })

    it('should create SOAP requests for each operation', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isSoapRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('soap')
        expect(req.soapAction).toBeDefined()
        expect(req.body).toBeDefined()
      })
    })

    it('should generate SOAP envelope in body', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        expect(req.body).toContain('soap:Envelope')
        expect(req.body).toContain('soap:Body')
      })
    })

    it('should set correct Content-Type header', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        const contentTypeHeader = req.headers.find((h) => h.key === 'Content-Type')
        expect(contentTypeHeader?.value.toString()).toContain('text/xml')
      })
    })

    it('should set SOAPAction header', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder
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
      }) as EnvironmentFolder
      const requests = findAllRequests(result, isSoapRequest)

      requests.forEach((req) => {
        expect(req.url).toBe('http://localhost:8080/soap')
      })
    })

    it('should generate unique IDs for all requests', () => {
      const result = importSoapFromString(wsdlFile, { name: 'SOAP Test' }) as EnvironmentFolder
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
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('AsyncAPI Test')
    })

    it('should create folders for each protocol', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder
      const folderNames = result.items.filter(isFolder).map((f) => f.name)

      // Docker AsyncAPI has MQTT and Socket.IO
      expect(folderNames.some((n) => n.includes('MQTT') || n.includes('Socket.IO') || n.includes('WebSocket'))).toBe(true)
    })

    it('should create WebSocket requests for each channel', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isWebSocketRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('websocket')
        expect(req.protocol).toBeDefined()
        expect(['websocket', 'socketio', 'mqtt']).toContain(req.protocol)
      })
    })

    it('should correctly identify protocols', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isWebSocketRequest)

      const protocols = new Set(requests.map((r) => r.protocol))
      // Docker AsyncAPI has mqtt and socketio
      expect(protocols.size).toBeGreaterThan(0)
    })

    it('should parse channel information', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder
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
      }) as EnvironmentFolder
      const defaultEnv = result.environments.find((e) => e.name === 'Default')
      const baseUrlVar = defaultEnv?.variables.find((v) => v.key === 'baseUrl')

      expect(baseUrlVar?.value.toString()).toBe('ws://localhost:3001')
    })

    it('should set event/topic names', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isWebSocketRequest)

      // Socket.IO and MQTT requests should have event/topic
      const socketioRequests = requests.filter((r) => r.protocol === 'socketio')
      socketioRequests.forEach((req) => {
        expect(req.event).toBeDefined()
      })
    })

    it('should generate unique IDs for all requests', () => {
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI Test' }) as EnvironmentFolder
      const requests = findAllRequests(result, isWebSocketRequest)
      const ids = requests.map((r) => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

// =============================================================================
// PostmanImportService Tests
// =============================================================================

describe('PostmanImportService', () => {
  const postmanJson = loadTestFile('postman-petstore.json')

  describe('importPostmanFromJson', () => {
    it('should import Postman collection and return an EnvironmentFolder', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('Swagger Petstore')
      expect(result.environments).toBeDefined()
      expect(result.environments.length).toBeGreaterThan(0)
    })

    it('should create environment with baseUrl variable', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const env = result.environments[0]

      expect(env).toBeDefined()
      expect(env?.variables.some((v) => v.key === 'baseUrl')).toBe(true)
    })

    it('should create nested folders for Postman folder structure', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder

      // Postman collection has pet, store, user folders
      const folderNames = result.items.filter(isFolder).map((f) => f.name)
      expect(folderNames).toContain('pet')
      expect(folderNames).toContain('store')
      expect(folderNames).toContain('user')
    })

    it('should create HTTP requests for each endpoint', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach((req) => {
        expect(req.type).toBe('http')
        expect(req.method).toBeDefined()
        expect(req.url).toBeDefined()
      })
    })

    it('should correctly parse HTTP methods', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const methods = new Set(requests.map((r) => r.method))
      // Petstore uses GET, POST, PUT, DELETE
      expect(methods.has('GET')).toBe(true)
      expect(methods.has('POST')).toBe(true)
      expect(methods.has('PUT')).toBe(true)
      expect(methods.has('DELETE')).toBe(true)
    })

    it('should parse headers from requests', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // At least some requests should have headers
      const requestsWithHeaders = requests.filter((r) => r.headers.length > 0)
      expect(requestsWithHeaders.length).toBeGreaterThan(0)
    })

    it('should parse query parameters', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // Find requests with query params (e.g., findByStatus)
      const requestsWithParams = requests.filter((r) => r.params.length > 0)
      expect(requestsWithParams.length).toBeGreaterThan(0)
    })

    it('should parse path parameters', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // Find requests with path params (e.g., GET /pet/{petId})
      const requestsWithPathParams = requests.filter((r) => r.pathParams && r.pathParams.length > 0)
      expect(requestsWithPathParams.length).toBeGreaterThan(0)
    })

    it('should convert path variables from :var to {{var}} format', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // URLs should use {{var}} format, not :var
      const requestsWithTemplateVars = requests.filter((r) => r.url.includes('{{'))
      expect(requestsWithTemplateVars.length).toBeGreaterThan(0)
      
      // No URLs should have :var format after conversion
      requests.forEach((req) => {
        // Only check if URL doesn't start with http (path variables are in path, not protocol)
        const pathPart = req.url.replace(/^https?:\/\/[^/]+/, '')
        expect(pathPart).not.toMatch(/:[a-zA-Z_][a-zA-Z0-9_]*/)
      })
    })

    it('should parse request bodies', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // POST/PUT requests should have bodies
      const requestsWithBody = requests.filter((r) => r.body !== undefined)
      expect(requestsWithBody.length).toBeGreaterThan(0)
    })

    it('should handle form-data bodies', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // Find requests with formdata body
      const formDataRequests = requests.filter(
        (r) => r.body?.type === 'form-data'
      )
      expect(formDataRequests.length).toBeGreaterThan(0)
    })

    it('should handle urlencoded bodies', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // Find requests with urlencoded body
      const urlencodedRequests = requests.filter(
        (r) => r.body?.type === 'x-www-form-urlencoded'
      )
      expect(urlencodedRequests.length).toBeGreaterThan(0)
    })

    it('should handle raw JSON bodies', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      // Find requests with raw text body (JSON)
      const rawBodyRequests = requests.filter(
        (r) => r.body?.type === 'text'
      )
      expect(rawBodyRequests.length).toBeGreaterThan(0)
    })

    it('should use custom baseUrl option', () => {
      const result = importPostmanFromJson(postmanJson, {
        baseUrl: 'http://custom.url'
      }) as EnvironmentFolder

      const env = result.environments[0]
      const baseUrlVar = env?.variables.find((v) => v.key === 'baseUrl')
      // Collection variables are now wrapped via `createTypedKeyValue`
      // (StringValue / ExpressionValue depending on `{{…}}` presence),
      // so unwrap via `toString()` rather than comparing the raw shape.
      expect(baseUrlVar?.value.toString()).toBe('http://custom.url')
    })

    it('should generate unique IDs for all items', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)
      const ids = requests.map((r) => r.id)

      // All IDs should be unique
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should generate deterministic IDs', () => {
      const result1 = importPostmanFromJson(postmanJson) as EnvironmentFolder
      const result2 = importPostmanFromJson(postmanJson) as EnvironmentFolder

      const requests1 = findAllRequests(result1, isHTTPRequest)
      const requests2 = findAllRequests(result2, isHTTPRequest)

      // Same content should produce same IDs
      expect(requests1.length).toBe(requests2.length)
      for (let i = 0; i < requests1.length; i++) {
        expect(requests1[i].id).toBe(requests2[i].id)
      }
    })

    it('should include documentation from descriptions', () => {
      const result = importPostmanFromJson(postmanJson) as EnvironmentFolder

      // Docs are now stored on the root ApiDocumentation object
      expect(result.apiDocumentation).toBeDefined()
      expect(result.apiDocumentation?.api.title).toBeTruthy()
    })

    it('should throw on invalid JSON', () => {
      expect(() => { importPostmanFromJson('not valid json') }).toThrow()
    })

    it('should throw on unsupported schema version', () => {
      const invalidCollection = JSON.stringify({
        info: {
          name: 'Test',
          schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json'
        },
        item: []
      })
      expect(() => { importPostmanFromJson(invalidCollection) }).toThrow(/Unsupported Postman collection schema/)
    })
  })
})

// =============================================================================
// InsomniaImportService Tests
// =============================================================================

describe('InsomniaImportService', () => {
  const insomniaJson = loadTestFile('insomnia-petstore.json')

  describe('importInsomniaFromJson', () => {
    it('should import Insomnia export and return an EnvironmentFolder', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('Petstore API')
      expect(result.environments).toBeDefined()
      expect(result.environments.length).toBeGreaterThan(0)
    })

    it('should create environments from Insomnia environments', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder

      // Should have Production and Development environments
      const envNames = result.environments.map(e => e.name)
      expect(envNames).toContain('Production')
      expect(envNames).toContain('Development')
    })

    it('should extract environment variables', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const prodEnv = result.environments.find(e => e.name === 'Production')

      expect(prodEnv).toBeDefined()
      expect(prodEnv?.variables.some(v => v.key === 'baseUrl')).toBe(true)
      expect(prodEnv?.variables.some(v => v.key === 'apiKey')).toBe(true)
    })

    it('should create nested folders from request groups', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder

      const folderNames = result.items.filter(isFolder).map(f => f.name)
      expect(folderNames).toContain('Pets')
      expect(folderNames).toContain('Store')
      expect(folderNames).toContain('Users')
    })

    it('should create HTTP requests', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach(req => {
        expect(req.type).toBe('http')
        expect(req.method).toBeDefined()
        expect(req.url).toBeDefined()
      })
    })

    it('should correctly parse HTTP methods', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const methods = new Set(requests.map(r => r.method))
      expect(methods.has('GET')).toBe(true)
      expect(methods.has('POST')).toBe(true)
      expect(methods.has('PUT')).toBe(true)
      expect(methods.has('DELETE')).toBe(true)
      expect(methods.has('PATCH')).toBe(true)
    })

    it('should parse headers from requests', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithHeaders = requests.filter(r => r.headers.length > 0)
      expect(requestsWithHeaders.length).toBeGreaterThan(0)
    })

    it('should parse query parameters', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithParams = requests.filter(r => r.params.length > 0)
      expect(requestsWithParams.length).toBeGreaterThan(0)
    })

    it('should extract path parameters from URL', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithPathParams = requests.filter(r => r.pathParams && r.pathParams.length > 0)
      expect(requestsWithPathParams.length).toBeGreaterThan(0)
    })

    it('should parse JSON request bodies', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithTextBody = requests.filter(r => r.body?.type === 'text')
      expect(requestsWithTextBody.length).toBeGreaterThan(0)
    })

    it('should handle form-data bodies', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const formDataRequests = requests.filter(r => r.body?.type === 'form-data')
      expect(formDataRequests.length).toBeGreaterThan(0)
    })

    it('should handle urlencoded bodies', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const urlencodedRequests = requests.filter(r => r.body?.type === 'x-www-form-urlencoded')
      expect(urlencodedRequests.length).toBeGreaterThan(0)
    })

    it('should detect and convert GraphQL requests', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isGraphQLRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach(req => {
        expect(req.type).toBe('graphql')
        expect(req.query).toBeDefined()
      })
    })

    it('should use custom baseUrl option', () => {
      const result = importInsomniaFromJson(insomniaJson, {
        baseUrl: 'http://custom.url'
      }) as EnvironmentFolder

      const env = result.environments[0]
      const baseUrlVar = env?.variables.find(v => v.key === 'baseUrl')
      expect(baseUrlVar?.value.toString()).toBe('http://custom.url')
    })

    it('should generate unique IDs for all items', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)
      const ids = requests.map(r => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should generate deterministic IDs', () => {
      const result1 = importInsomniaFromJson(insomniaJson) as EnvironmentFolder
      const result2 = importInsomniaFromJson(insomniaJson) as EnvironmentFolder

      const requests1 = findAllRequests(result1, isHTTPRequest)
      const requests2 = findAllRequests(result2, isHTTPRequest)

      expect(requests1.length).toBe(requests2.length)
      for (let i = 0; i < requests1.length; i++) {
        expect(requests1[i].id).toBe(requests2[i].id)
      }
    })

    it('should include documentation from descriptions', () => {
      const result = importInsomniaFromJson(insomniaJson) as EnvironmentFolder

      // Docs are now stored on the root ApiDocumentation object
      expect(result.apiDocumentation).toBeDefined()
      expect(result.apiDocumentation?.api.title).toBeTruthy()
    })

    it('should throw on invalid JSON', () => {
      expect(() => { importInsomniaFromJson('not valid json') }).toThrow()
    })

    it('should throw on unsupported export format', () => {
      const invalidExport = JSON.stringify({
        _type: 'export',
        __export_format: 3,
        resources: []
      })
      expect(() => { importInsomniaFromJson(invalidExport) }).toThrow(/Unsupported Insomnia export format/)
    })

    it('should throw on invalid export type', () => {
      const invalidExport = JSON.stringify({
        _type: 'invalid',
        __export_format: 4,
        resources: []
      })
      expect(() => { importInsomniaFromJson(invalidExport) }).toThrow(/Invalid Insomnia export/)
    })
  })
})

// =============================================================================
// BrunoImportService Tests
// =============================================================================

describe('BrunoImportService', () => {
  const brunoJson = loadTestFile('bruno-petstore.json')

  describe('importBrunoFromJson', () => {
    it('should import Bruno collection and return an EnvironmentFolder', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder

      expect(result).toBeDefined()
      expect(result.folderType).toBe('environment')
      expect(result.name).toBe('Petstore API')
      expect(result.environments).toBeDefined()
      expect(result.environments.length).toBeGreaterThan(0)
    })

    it('should create environment', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const env = result.environments[0]

      expect(env).toBeDefined()
      expect(env?.name).toBe('Default')
    })

    it('should create nested folders', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder

      const folderNames = result.items.filter(isFolder).map(f => f.name)
      expect(folderNames).toContain('Pets')
      expect(folderNames).toContain('Store')
      expect(folderNames).toContain('Users')
    })

    it('should create HTTP requests', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach(req => {
        expect(req.type).toBe('http')
        expect(req.method).toBeDefined()
        expect(req.url).toBeDefined()
      })
    })

    it('should correctly parse HTTP methods', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const methods = new Set(requests.map(r => r.method))
      expect(methods.has('GET')).toBe(true)
      expect(methods.has('POST')).toBe(true)
      expect(methods.has('PUT')).toBe(true)
      expect(methods.has('DELETE')).toBe(true)
      expect(methods.has('PATCH')).toBe(true)
    })

    it('should parse headers from requests', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithHeaders = requests.filter(r => r.headers.length > 0)
      expect(requestsWithHeaders.length).toBeGreaterThan(0)
    })

    it('should parse query parameters', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithParams = requests.filter(r => r.params.length > 0)
      expect(requestsWithParams.length).toBeGreaterThan(0)
    })

    it('should parse path parameters', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithPathParams = requests.filter(r => r.pathParams && r.pathParams.length > 0)
      expect(requestsWithPathParams.length).toBeGreaterThan(0)
    })

    it('should parse JSON request bodies', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const requestsWithTextBody = requests.filter(r => r.body?.type === 'text')
      expect(requestsWithTextBody.length).toBeGreaterThan(0)
    })

    it('should handle form-data bodies', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const formDataRequests = requests.filter(r => r.body?.type === 'form-data')
      expect(formDataRequests.length).toBeGreaterThan(0)
    })

    it('should handle urlencoded bodies', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)

      const urlencodedRequests = requests.filter(r => r.body?.type === 'x-www-form-urlencoded')
      expect(urlencodedRequests.length).toBeGreaterThan(0)
    })

    it('should detect and convert GraphQL requests', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isGraphQLRequest)

      expect(requests.length).toBeGreaterThan(0)
      requests.forEach(req => {
        expect(req.type).toBe('graphql')
        expect(req.query).toBeDefined()
      })
    })

    it('should use custom baseUrl option', () => {
      const result = importBrunoFromJson(brunoJson, {
        baseUrl: 'http://custom.url'
      }) as EnvironmentFolder

      const env = result.environments[0]
      const baseUrlVar = env?.variables.find(v => v.key === 'baseUrl')
      expect(baseUrlVar?.value.toString()).toBe('http://custom.url')
    })

    it('should generate unique IDs for all items', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const requests = findAllRequests(result, isHTTPRequest)
      const ids = requests.map(r => r.id)

      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should generate deterministic IDs', () => {
      const result1 = importBrunoFromJson(brunoJson) as EnvironmentFolder
      const result2 = importBrunoFromJson(brunoJson) as EnvironmentFolder

      const requests1 = findAllRequests(result1, isHTTPRequest)
      const requests2 = findAllRequests(result2, isHTTPRequest)

      expect(requests1.length).toBe(requests2.length)
      for (let i = 0; i < requests1.length; i++) {
        expect(requests1[i].id).toBe(requests2[i].id)
      }
    })

    it('should include documentation from docs field', () => {
      const result = importBrunoFromJson(brunoJson) as EnvironmentFolder

      // Docs are now stored on the root ApiDocumentation object
      expect(result.apiDocumentation).toBeDefined()
      expect(result.apiDocumentation?.operations.length).toBeGreaterThan(0)
    })

    it('should throw on invalid JSON', () => {
      expect(() => { importBrunoFromJson('not valid json') }).toThrow()
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
    const postman = importPostmanFromJson(loadTestFile('postman-petstore.json'))
    const insomnia = importInsomniaFromJson(loadTestFile('insomnia-petstore.json'))
    const bruno = importBrunoFromJson(loadTestFile('bruno-petstore.json'))

    const results = [swagger, graphql, grpc, soap, asyncapi, postman, insomnia, bruno]

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
    const postman = importPostmanFromJson(loadTestFile('postman-petstore.json'))
    const insomnia = importInsomniaFromJson(loadTestFile('insomnia-petstore.json'))
    const bruno = importBrunoFromJson(loadTestFile('bruno-petstore.json'))

    const results = [swagger, graphql, grpc, soap, asyncapi, postman, insomnia, bruno]

    results.forEach((result) => {
      expect(result.environments.length).toBeGreaterThan(0)
    })
  })

  it('stamps fileFormatVersion = CURRENT_FILE_FORMAT_VERSION on every importer output', () => {
    const swagger = importSwaggerFromJson(loadTestFile('swagger-petstore.json'))
    const graphql = importGraphQLFromString(loadTestFile('graphql-docker.graphql'), { name: 'GraphQL' })
    const grpc = importGrpcFromString(loadTestFile('grpc-docker.proto'), { name: 'gRPC' })
    const soap = importSoapFromString(loadTestFile('soap-docker.wsdl'), { name: 'SOAP' })
    const asyncapi = importAsyncAPIFromString(loadTestFile('asyncapi-docker.yaml'), { name: 'AsyncAPI' })
    const postman = importPostmanFromJson(loadTestFile('postman-petstore.json'))
    const insomnia = importInsomniaFromJson(loadTestFile('insomnia-petstore.json'))
    const bruno = importBrunoFromJson(loadTestFile('bruno-petstore.json'))
    const curl = importCurl('curl https://example.com/api/items')
    const powershell = importPowerShell('Invoke-RestMethod -Uri https://example.com/api/items')
    const restClient = importRestClient('GET https://example.com/api/items')

    const results: EnvironmentFolder[] = [
      swagger,
      graphql,
      grpc,
      soap,
      asyncapi,
      postman,
      insomnia,
      bruno,
      curl,
      powershell,
      restClient
    ]
    for (const result of results) {
      expect(result.fileFormatVersion, `importer ${result.importSource ?? 'unknown'} missing fileFormatVersion`).toBe(CURRENT_FILE_FORMAT_VERSION)
    }
  })

  it('should generate unique IDs across different imports', () => {
    // Run the same import twice to ensure IDs are unique
    const import1 = importSwaggerFromJson(loadTestFile('swagger-petstore.json')) as EnvironmentFolder
    const import2 = importSwaggerFromJson(loadTestFile('swagger-petstore.json')) as EnvironmentFolder

    const requests1 = findAllRequests(import1, isHTTPRequest)
    const requests2 = findAllRequests(import2, isHTTPRequest)

    // Same content should produce same IDs (deterministic)
    expect(requests1.length).toBe(requests2.length)
    for (let i = 0; i < requests1.length; i++) {
      expect(requests1[i].id).toBe(requests2[i].id)
    }
  })
})
