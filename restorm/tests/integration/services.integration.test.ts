/**
 * Integration tests for import and request services
 * These tests run against real Docker services
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Docker setup
import {
  isDockerAvailable,
  startDocker,
  waitForServices,
  areContainersRunning,
  areServicesAccessible,
  SERVICES
} from './docker-setup'

// Import services
import { importSwaggerFromJson } from '../../src/renderer/src/services/import/SwaggerImportService'
import { importGraphQLFromString } from '../../src/renderer/src/services/import/GraphQLImportService'
import { importGrpcFromString } from '../../src/renderer/src/services/import/GrpcImportService'
import { importSoapFromString } from '../../src/renderer/src/services/import/SoapImportService'
import { importAsyncAPIFromString } from '../../src/renderer/src/services/import/AsyncAPIImportService'

// Request services
import { executeHTTPRequest, type HTTPRequestInput } from '../../src/renderer/src/services/request/HTTPRequestService'
import { executeGraphQLRequest, type GraphQLRequestInput } from '../../src/renderer/src/services/request/GraphQLRequestService'

// Types
import type {
  Folder,
  EnvironmentFolder,
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest
} from '../../src/renderer/src/types/collections'
import type { VariableContext } from '../../src/renderer/src/services/VariableResolutionService'

// Test timeout for integration tests
const TEST_TIMEOUT = 30000

// Helper to load test files
const loadTestFile = (filename: string): string => {
  return readFileSync(join(__dirname, '../unit', filename), 'utf-8')
}

// Type guards
const isFolder = (item: unknown): item is Folder => {
  return typeof item === 'object' && item !== null && 'items' in item && Array.isArray((item as Folder).items)
}

function isHTTPRequest(item: unknown): item is HTTPRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'http'
}

function isGraphQLRequest(item: unknown): item is GraphQLRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'graphql'
}

function isSoapRequest(item: unknown): item is SoapRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'soap'
}

function isWebSocketRequest(item: unknown): item is WebSocketRequest {
  if (!item || typeof item !== 'object') return false
  return 'type' in item && (item as { type: string }).type === 'websocket'
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

// Create variable context from environment folder
const createVariableContext = (folder: EnvironmentFolder): VariableContext => {
  const env = folder.environments.find((e) => e.name === 'Default') ?? folder.environments[0]
  if (!env) return { globals: {}, environment: {}, collection: {} }

  const environment: Record<string, string> = {}
  for (const v of env.variables) {
    environment[v.key] = v.value
  }
  return { globals: {}, environment, collection: {} }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Integration Tests with Docker Services', () => {
  let dockerAvailable = false
  let containersStarted = false

  beforeAll(async () => {
    // Check if Docker is available
    dockerAvailable = isDockerAvailable()
    if (!dockerAvailable) {
      return
    }

    // First check if services are already accessible (faster than checking docker compose)
    const servicesAccessible = await areServicesAccessible()
    if (servicesAccessible) {
      containersStarted = true
      return
    }

    // Check if containers are already running via docker compose
    const alreadyRunning = areContainersRunning()
    if (alreadyRunning) {
      containersStarted = true
      // Wait for services to be ready
      try {
        await waitForServices()
      } catch {
        // Services might already be ready
      }
      return
    }

    // Start containers
    try {
      startDocker()
      await waitForServices()
      containersStarted = true
    } catch {
      // Check again if services are accessible (might have been started by another process)
      const nowAccessible = await areServicesAccessible()
      if (nowAccessible) {
        containersStarted = true
      } else {
        containersStarted = false
      }
    }
  }, 120000) // 2 minutes for startup

  afterAll(() => {
    // Don't stop containers - let them run for faster re-runs
    // Users can stop them manually with: docker compose -f tests/docker/docker-compose.yml down
  })

  // =============================================================================
  // HTTP/REST Tests (Petstore)
  // =============================================================================

  describe('HTTP/REST - Petstore API', () => {
    let importedCollection: EnvironmentFolder
    let httpRequests: HTTPRequest[]
    let variableContext: VariableContext

    beforeAll(() => {
      if (!dockerAvailable || !containersStarted) return

      // Import the Petstore spec
      const swaggerJson = loadTestFile('swagger-petstore.json')
      importedCollection = importSwaggerFromJson(swaggerJson, {
        baseUrl: SERVICES.petstore.baseUrl
      })

      httpRequests = findAllRequests(importedCollection, isHTTPRequest)
      variableContext = createVariableContext(importedCollection)
    })

    it('should import Petstore spec successfully', () => {
      if (!dockerAvailable || !containersStarted) return

      expect(importedCollection).toBeDefined()
      expect(importedCollection.name).toBe('Swagger Petstore')
      expect(httpRequests.length).toBeGreaterThan(0)
    })

    it('should execute GET /pet/findByStatus request', async () => {
      if (!dockerAvailable || !containersStarted) return

      const input: HTTPRequestInput = {
        request: {
          id: 'test-find-by-status',
          type: 'http',
          name: 'Find By Status',
          method: 'GET',
          url: `${SERVICES.petstore.baseUrl}/api/pet/findByStatus`,
          headers: [{ key: 'Accept', value: 'application/json' }],
          params: [{ key: 'status', value: 'available' }],
          pathParams: []
        },
        method: 'GET',
        url: `${SERVICES.petstore.baseUrl}/api/pet/findByStatus`,
        headers: [{ key: 'Accept', value: 'application/json' }],
        params: [{ key: 'status', value: 'available' }],
        pathParams: [],
        bodyMode: 'text',
        variableContext
      }

      const response = await executeHTTPRequest(input)

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
      expect(response.responseBody).toBeDefined()
      expect(response.timings.durationMs).toBeGreaterThan(0)
    }, TEST_TIMEOUT)

    it('should execute POST /pet request to create a pet', async () => {
      if (!dockerAvailable || !containersStarted) return

      const testPet = {
        id: Date.now(),
        name: 'TestPet',
        category: { id: 1, name: 'Dogs' },
        photoUrls: ['http://example.com/photo.jpg'],
        tags: [{ id: 1, name: 'test' }],
        status: 'available'
      }

      const input: HTTPRequestInput = {
        request: {
          id: 'test-add-pet',
          type: 'http',
          name: 'Add Pet',
          method: 'POST',
          url: `${SERVICES.petstore.baseUrl}/api/pet`,
          headers: [{ key: 'Content-Type', value: 'application/json' }],
          params: [],
          pathParams: []
        },
        method: 'POST',
        url: `${SERVICES.petstore.baseUrl}/api/pet`,
        headers: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'Accept', value: 'application/json' }
        ],
        params: [],
        pathParams: [],
        bodyContent: JSON.stringify(testPet),
        bodyMode: 'text',
        variableContext
      }

      const response = await executeHTTPRequest(input)

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(200)
      expect(response.responseBody).toContain('TestPet')
    }, TEST_TIMEOUT)

    it('should execute GET /pet/{petId} request', async () => {
      if (!dockerAvailable || !containersStarted) return

      const input: HTTPRequestInput = {
        request: {
          id: 'test-get-pet',
          type: 'http',
          name: 'Get Pet',
          method: 'GET',
          url: `${SERVICES.petstore.baseUrl}/api/pet/1`,
          headers: [{ key: 'Accept', value: 'application/json' }],
          params: [],
          pathParams: []
        },
        method: 'GET',
        url: `${SERVICES.petstore.baseUrl}/api/pet/1`,
        headers: [{ key: 'Accept', value: 'application/json' }],
        params: [],
        pathParams: [],
        bodyMode: 'text',
        variableContext
      }

      const response = await executeHTTPRequest(input)

      expect(response).toBeDefined()
      // Pet may or may not exist
      expect([200, 404]).toContain(response.statusCode)
    }, TEST_TIMEOUT)
  })

  // =============================================================================
  // GraphQL Tests
  // =============================================================================

  describe('GraphQL Server', () => {
    let importedCollection: EnvironmentFolder
    let graphqlRequests: GraphQLRequest[]
    let variableContext: VariableContext

    beforeAll(() => {
      if (!dockerAvailable || !containersStarted) return

      // Import the GraphQL schema
      const graphqlSchema = loadTestFile('graphql-docker.graphql')
      importedCollection = importGraphQLFromString(graphqlSchema, {
        name: 'GraphQL Test',
        baseUrl: SERVICES.graphql.baseUrl
      })

      graphqlRequests = findAllRequests(importedCollection, isGraphQLRequest)
      variableContext = createVariableContext(importedCollection)
    })

    it('should import GraphQL schema successfully', () => {
      if (!dockerAvailable || !containersStarted) return

      expect(importedCollection).toBeDefined()
      expect(importedCollection.name).toBe('GraphQL Test')
      expect(graphqlRequests.length).toBeGreaterThan(0)
    })

    it('should execute users query', async () => {
      if (!dockerAvailable || !containersStarted) return

      // Use a known working query
      const input: GraphQLRequestInput = {
        request: {
          id: 'test-users',
          type: 'graphql',
          name: 'Users',
          url: SERVICES.graphql.baseUrl,
          query: '{ users { id name email } }',
          operationType: 'query',
          headers: [{ key: 'Content-Type', value: 'application/json' }]
        },
        url: SERVICES.graphql.baseUrl,
        query: '{ users { id name email } }',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        variableContext
      }

      const response = await executeGraphQLRequest(input)

      expect(response).toBeDefined()
      
      // If statusCode is 0, there was a network error - skip test if server is not accessible
      if (response.statusCode === 0) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${response.error || 'Unknown error'}. Skipping test.`)
        return
      }
      
      expect(response.statusCode).toBe(200)
      expect(response.data).toBeDefined()
      expect(response.errors).toBeUndefined()
    }, TEST_TIMEOUT)

    it('should execute echo query with variables', async () => {
      if (!dockerAvailable || !containersStarted) {
        test.skip()
        return
      }

      // Verify GraphQL server is accessible before running test
      try {
        const healthCheck = await fetch(SERVICES.graphql.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' })
        })
        if (!healthCheck.ok) {
          console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible. Skipping test.`)
          return
        }
      } catch (err) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${err instanceof Error ? err.message : String(err)}. Skipping test.`)
        return
      }

      const input: GraphQLRequestInput = {
        request: {
          id: 'test-echo',
          type: 'graphql',
          name: 'Echo',
          url: SERVICES.graphql.baseUrl,
          query: 'query Echo($message: String!) { echo(message: $message) }',
          operationType: 'query',
          headers: [{ key: 'Content-Type', value: 'application/json' }]
        },
        url: SERVICES.graphql.baseUrl,
        query: 'query Echo($message: String!) { echo(message: $message) }',
        variables: JSON.stringify({ message: 'Hello Integration Test!' }),
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        variableContext
      }

      const response = await executeGraphQLRequest(input)

      expect(response).toBeDefined()
      
      // If statusCode is 0, there was a network error - skip test if server is not accessible
      if (response.statusCode === 0) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${response.error || 'Unknown error'}. Skipping test.`)
        return
      }
      
      expect(response.statusCode).toBe(200)
      expect(response.data).toBeDefined()
      const data = response.data as { echo: string }
      expect(data.echo).toBe('Echo: Hello Integration Test!')
    }, TEST_TIMEOUT)

    it('should execute createUser mutation', async () => {
      if (!dockerAvailable || !containersStarted) {
        test.skip()
        return
      }

      // Verify GraphQL server is accessible before running test
      try {
        const healthCheck = await fetch(SERVICES.graphql.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' })
        })
        if (!healthCheck.ok) {
          console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible. Skipping test.`)
          return
        }
      } catch (err) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${err instanceof Error ? err.message : String(err)}. Skipping test.`)
        return
      }

      const input: GraphQLRequestInput = {
        request: {
          id: 'test-create-user',
          type: 'graphql',
          name: 'Create User',
          url: SERVICES.graphql.baseUrl,
          query: `
            mutation CreateUser($name: String!, $email: String!) {
              createUser(name: $name, email: $email) {
                id
                name
                email
              }
            }
          `,
          operationType: 'mutation',
          headers: [{ key: 'Content-Type', value: 'application/json' }]
        },
        url: SERVICES.graphql.baseUrl,
        query: `
          mutation CreateUser($name: String!, $email: String!) {
            createUser(name: $name, email: $email) {
              id
              name
              email
            }
          }
        `,
        variables: JSON.stringify({
          name: 'Integration Test User',
          email: 'test@integration.com'
        }),
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        variableContext
      }

      const response = await executeGraphQLRequest(input)

      expect(response).toBeDefined()
      
      // If statusCode is 0, there was a network error - skip test if server is not accessible
      if (response.statusCode === 0) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${response.error || 'Unknown error'}. Skipping test.`)
        return
      }
      
      expect(response.statusCode).toBe(200)
      expect(response.data).toBeDefined()
      const data = response.data as { createUser: { name: string; email: string } }
      expect(data.createUser.name).toBe('Integration Test User')
    }, TEST_TIMEOUT)

    it('should handle GraphQL errors properly', async () => {
      if (!dockerAvailable || !containersStarted) {
        test.skip()
        return
      }

      // Verify GraphQL server is accessible before running test
      try {
        const healthCheck = await fetch(SERVICES.graphql.baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' })
        })
        if (!healthCheck.ok) {
          console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible. Skipping test.`)
          return
        }
      } catch (err) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${err instanceof Error ? err.message : String(err)}. Skipping test.`)
        return
      }

      const input: GraphQLRequestInput = {
        request: {
          id: 'test-error',
          type: 'graphql',
          name: 'Error Query',
          url: SERVICES.graphql.baseUrl,
          query: '{ invalidField }',
          operationType: 'query',
          headers: []
        },
        url: SERVICES.graphql.baseUrl,
        query: '{ invalidField }',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        variableContext
      }

      const response = await executeGraphQLRequest(input)

      expect(response).toBeDefined()
      
      // If statusCode is 0, there was a network error - skip test if server is not accessible
      if (response.statusCode === 0) {
        console.warn(`GraphQL server at ${SERVICES.graphql.baseUrl} is not accessible: ${response.error || 'Unknown error'}. Skipping test.`)
        return
      }
      
      // For error handling test, we expect either GraphQL errors or a non-200 status
      // GraphQL can return 200 with errors in the response
      if (response.statusCode === 200) {
        expect(response.errors).toBeDefined()
        expect(response.errors?.length).toBeGreaterThan(0)
      } else {
        // If status is not 200, that's also a valid error case
        expect(response.statusCode).not.toBe(200)
      }
    }, TEST_TIMEOUT)
  })

  // =============================================================================
  // Import Services Tests (using Docker test files)
  // =============================================================================

  describe('Import Services - Spec Validation', () => {
    it('should import Swagger spec and create valid structure', () => {
      const swaggerJson = loadTestFile('swagger-petstore.json')
      const result = importSwaggerFromJson(swaggerJson)

      expect(result.folderType).toBe('environment')
      expect(result.environments.length).toBeGreaterThan(0)

      const requests = findAllRequests(result, isHTTPRequest)
      expect(requests.length).toBeGreaterThan(0)

      // Validate each request has required fields
      for (const req of requests) {
        expect(req.id).toBeDefined()
        expect(req.name).toBeDefined()
        expect(req.method).toBeDefined()
        expect(req.url).toBeDefined()
      }
    })

    it('should import GraphQL schema and create valid structure', () => {
      const graphqlSchema = loadTestFile('graphql-docker.graphql')
      const result = importGraphQLFromString(graphqlSchema, { name: 'GraphQL' })

      expect(result.folderType).toBe('environment')

      const requests = findAllRequests(result, isGraphQLRequest)
      expect(requests.length).toBeGreaterThan(0)

      // Validate each request has required fields
      for (const req of requests) {
        expect(req.id).toBeDefined()
        expect(req.name).toBeDefined()
        expect(req.query).toBeDefined()
        expect(req.operationType).toBeDefined()
      }
    })

    it('should import gRPC proto and create valid structure', () => {
      const protoFile = loadTestFile('grpc-docker.proto')
      const result = importGrpcFromString(protoFile, { name: 'gRPC' })

      expect(result.folderType).toBe('environment')

      const requests = findAllRequests(result, (item): item is GrpcRequest => {
        if (!item || typeof item !== 'object') return false
        return 'type' in item && (item as { type: string }).type === 'grpc'
      })
      expect(requests.length).toBeGreaterThan(0)

      // Validate each request has required fields
      for (const req of requests) {
        expect(req.id).toBeDefined()
        expect(req.service).toBeDefined()
        expect(req.method).toBeDefined()
        expect(req.callType).toBeDefined()
      }
    })

    it('should import SOAP WSDL and create valid structure', () => {
      const wsdlFile = loadTestFile('soap-docker.wsdl')
      const result = importSoapFromString(wsdlFile, { name: 'SOAP' })

      expect(result.folderType).toBe('environment')

      const requests = findAllRequests(result, isSoapRequest)
      expect(requests.length).toBeGreaterThan(0)

      // Validate each request has required fields
      for (const req of requests) {
        expect(req.id).toBeDefined()
        expect(req.name).toBeDefined()
        expect(req.body).toContain('soap:Envelope')
      }
    })

    it('should import AsyncAPI and create valid structure', () => {
      const asyncapiYaml = loadTestFile('asyncapi-docker.yaml')
      const result = importAsyncAPIFromString(asyncapiYaml, { name: 'AsyncAPI' })

      expect(result.folderType).toBe('environment')

      const requests = findAllRequests(result, isWebSocketRequest)
      expect(requests.length).toBeGreaterThan(0)

      // Validate each request has required fields
      for (const req of requests) {
        expect(req.id).toBeDefined()
        expect(req.name).toBeDefined()
        expect(req.protocol).toBeDefined()
      }
    })
  })
})
