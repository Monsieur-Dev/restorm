/**
 * Unit tests for DocumentationCompiler — route matching + Markdown compilation.
 *
 * These focus on the pure logic and template rendering. Anything that requires
 * `electron.app` at module load is stubbed out via vitest's hoisted mock.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { ApiDocumentation } from '../../../src/shared/types/apiDocumentation'
import * as path from 'path'

// electron.app.isPackaged is consulted at runtime; stub it before importing the compiler.
vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

// electron-core-ui/main brings the Electron app transitively; only `logger` is needed.
vi.mock('electron-core-ui/main', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const {
  findOperationForRoute,
  compileOperationMarkdown,
  compileGroupMarkdown,
  compileRootMarkdown,
  compileDocumentationForRoute,
  resetDocumentationCompilerCache,
  setApiDocsTemplatesPath
} = await import('../../../src/main/services/DocumentationCompiler')

const realTemplatesPath = path.resolve(__dirname, '../../../src/main/resources/templates/api-docs')
setApiDocsTemplatesPath(realTemplatesPath)

beforeEach(() => {
  resetDocumentationCompilerCache()
})

// ============================================================================
// Fixtures
// ============================================================================

function makeSwaggerDoc(): ApiDocumentation {
  return {
    sourceType: 'swagger',
    api: { title: 'Petstore', version: '1.0.0', description: 'A sample pet store API.' },
    server: { host: 'petstore.example.com', basePath: '/api', schemes: ['https'] },
    models: {
      Pet: {
        name: 'Pet',
        description: 'A pet.',
        properties: [
          { name: 'id', type: 'integer', required: true },
          { name: 'name', type: 'string', required: true, description: 'Pet name' }
        ]
      }
    },
    groups: {
      pet: { name: 'pet', description: 'Pet operations' }
    },
    operations: [
      {
        match: { urlPattern: '/pet/{petId}', method: 'GET' },
        group: 'pet',
        summary: 'Find pet by ID',
        description: 'Returns a single pet.',
        operationId: 'getPetById',
        parameters: [
          { name: 'petId', location: 'path', type: 'integer', required: true, description: 'ID of pet to return' }
        ],
        responses: {
          '200': { description: 'successful', schema: 'Pet' },
          '404': { description: 'Pet not found' }
        },
        referencedModels: ['Pet']
      },
      {
        match: { urlPattern: '/pet', method: 'POST' },
        group: 'pet',
        summary: 'Add a new pet',
        operationId: 'addPet',
        referencedModels: ['Pet']
      }
    ]
  }
}

function makeGraphqlDoc(): ApiDocumentation {
  return {
    sourceType: 'graphql',
    api: { title: 'GraphQL API' },
    models: {},
    groups: {
      Queries: { name: 'Queries', description: 'Read operations' },
      Mutations: { name: 'Mutations' }
    },
    operations: [
      {
        match: { urlPattern: 'http://localhost:4000/graphql', operationType: 'query', operationName: 'allPets' },
        group: 'Queries',
        summary: 'List all pets'
      },
      {
        match: { urlPattern: 'http://localhost:4000/graphql', operationType: 'mutation', operationName: 'addPet' },
        group: 'Mutations',
        summary: 'Add a new pet'
      }
    ]
  }
}

function makeGrpcDoc(): ApiDocumentation {
  return {
    sourceType: 'grpc',
    api: { title: 'PetStore gRPC' },
    models: {},
    groups: { 'petstore.PetService': { name: 'petstore.PetService' } },
    operations: [
      {
        match: { urlPattern: 'grpc://petstore.PetService/GetPet', serviceName: 'petstore.PetService', operationName: 'GetPet' },
        group: 'petstore.PetService',
        summary: 'Fetch a pet by id',
        extra: { callType: 'unary' }
      }
    ]
  }
}

function makeSoapDoc(): ApiDocumentation {
  return {
    sourceType: 'wsdl',
    api: { title: 'WeatherService' },
    server: { namespace: 'http://weather.example.com/' },
    models: {},
    groups: {},
    operations: [
      {
        match: { urlPattern: '/soap/weather', soapAction: 'http://weather.example.com/GetForecast', operationName: 'GetForecast', serviceName: 'WeatherService' },
        summary: 'Get the forecast'
      }
    ]
  }
}

function makeAsyncapiDoc(): ApiDocumentation {
  return {
    sourceType: 'asyncapi',
    api: { title: 'Chat' },
    models: {},
    groups: { WebSocket: { name: 'WebSocket' } },
    operations: [
      {
        match: { urlPattern: '/chat/messages', event: '/chat/messages', direction: 'publish' },
        group: 'WebSocket',
        summary: 'Send a chat message'
      },
      {
        match: { urlPattern: '/chat/messages', event: '/chat/messages', direction: 'subscribe' },
        group: 'WebSocket',
        summary: 'Receive chat messages'
      }
    ]
  }
}

// ============================================================================
// findOperationForRoute
// ============================================================================

describe('findOperationForRoute — HTTP', () => {
  it('matches a templated URL against the operation urlPattern', () => {
    // `basePath` is folded into the resolved `{{baseUrl}}` at import time,
    // so request URL templates no longer carry the `/api` prefix.
    const doc = makeSwaggerDoc()
    const op = findOperationForRoute(doc, {
      type: 'http',
      url: '{{baseUrl}}/pet/{{petId}}',
      method: 'GET'
    })
    expect(op?.operationId).toBe('getPetById')
  })

  it('matches an absolute URL whose path aligns with urlPattern', () => {
    const doc = makeSwaggerDoc()
    const op = findOperationForRoute(doc, {
      type: 'http',
      url: 'https://petstore.example.com/pet/42',
      method: 'GET'
    })
    expect(op?.operationId).toBe('getPetById')
  })

  it('respects the HTTP method', () => {
    const doc = makeSwaggerDoc()
    const op = findOperationForRoute(doc, {
      type: 'http',
      url: '{{baseUrl}}/pet',
      method: 'POST'
    })
    expect(op?.operationId).toBe('addPet')
  })

  it('returns undefined when no operation matches', () => {
    const doc = makeSwaggerDoc()
    const op = findOperationForRoute(doc, {
      type: 'http',
      url: '{{baseUrl}}/store/order/1',
      method: 'GET'
    })
    expect(op).toBeUndefined()
  })

  it('rejects an edited URL whose segments no longer line up (no fuzzy suffix matching)', () => {
    // Host-prefix tampering shouldn't accidentally match: `/petXXX/1` must
    // not match `/pet/{petId}`, and neither should a wrong prefix like
    // `/apiXXX/pet/1` when the spec sets basePath = `/api`.
    const doc = makeSwaggerDoc()
    expect(findOperationForRoute(doc, { type: 'http', url: '{{baseUrl}}/petXXX/1', method: 'GET' })).toBeUndefined()
    expect(findOperationForRoute(doc, { type: 'http', url: '{{baseUrl}}/apiXXX/pet/1', method: 'GET' })).toBeUndefined()
  })
})

describe('findOperationForRoute — GraphQL', () => {
  it('matches by operationType + top-level field in the query', () => {
    const doc = makeGraphqlDoc()
    const op = findOperationForRoute(doc, {
      type: 'graphql',
      operationType: 'query',
      query: 'query Foo { allPets { id name } }'
    })
    expect(op?.summary).toBe('List all pets')
  })

  it('distinguishes mutation from query by operationType', () => {
    const doc = makeGraphqlDoc()
    const op = findOperationForRoute(doc, {
      type: 'graphql',
      operationType: 'mutation',
      query: 'mutation { addPet(name: "Rex") { id } }'
    })
    expect(op?.summary).toBe('Add a new pet')
  })
})

describe('findOperationForRoute — gRPC', () => {
  it('matches by serviceName + operationName', () => {
    const doc = makeGrpcDoc()
    const op = findOperationForRoute(doc, {
      type: 'grpc',
      service: 'petstore.PetService',
      rpcMethod: 'GetPet'
    })
    expect(op?.summary).toBe('Fetch a pet by id')
  })

  it('returns undefined when the service name disagrees', () => {
    const doc = makeGrpcDoc()
    const op = findOperationForRoute(doc, {
      type: 'grpc',
      service: 'other.Service',
      rpcMethod: 'GetPet'
    })
    expect(op).toBeUndefined()
  })
})

describe('findOperationForRoute — SOAP', () => {
  it('matches by SOAPAction when present (preferred)', () => {
    const doc = makeSoapDoc()
    const op = findOperationForRoute(doc, {
      type: 'soap',
      soapAction: 'http://weather.example.com/GetForecast',
      operation: 'WrongOne'
    })
    expect(op?.summary).toBe('Get the forecast')
  })

  it('falls back to operation name when SOAPAction is missing', () => {
    const doc = makeSoapDoc()
    const op = findOperationForRoute(doc, {
      type: 'soap',
      operation: 'GetForecast'
    })
    expect(op?.summary).toBe('Get the forecast')
  })
})

describe('findOperationForRoute — AsyncAPI / WebSocket', () => {
  it('distinguishes publish from subscribe via tags', () => {
    const doc = makeAsyncapiDoc()
    const publish = findOperationForRoute(doc, {
      type: 'websocket',
      event: '/chat/messages',
      tags: ['publish', 'websocket']
    })
    expect(publish?.summary).toBe('Send a chat message')

    const subscribe = findOperationForRoute(doc, {
      type: 'websocket',
      event: '/chat/messages',
      tags: ['subscribe', 'websocket']
    })
    expect(subscribe?.summary).toBe('Receive chat messages')
  })
})

// ============================================================================
// compile*Markdown
// ============================================================================

describe('compileOperationMarkdown', () => {
  it('renders a full operation doc including parameters, responses, and referenced models', () => {
    const doc = makeSwaggerDoc()
    const firstOp = doc.operations[0]
    if (!firstOp) throw new Error('fixture must expose an operation')
    const md = compileOperationMarkdown(doc, firstOp)

    expect(md).toContain('# Find pet by ID')
    // The rendered URL includes the server's basePath (folded out of the
    // operation's urlPattern to keep it reusable across environments).
    expect(md).toContain('**`GET`** `/api/pet/{petId}`')
    expect(md).toContain('Returns a single pet.')
    expect(md).toContain('| `petId` | path | `integer` | ✓ | ID of pet to return |')
    expect(md).toContain('### `200`')
    expect(md).toContain('**Schema:** `Pet`')
    expect(md).toContain('### `Pet`')
    expect(md).toContain('| `name` | `string` | ✓ | Pet name |')
  })

  it('collapses cleanly when the operation has no parameters or models', () => {
    const doc = makeSwaggerDoc()
    const secondOp = doc.operations[1]
    if (!secondOp) throw new Error('fixture must expose a second operation')
    const md = compileOperationMarkdown(doc, secondOp)

    expect(md).toContain('# Add a new pet')
    expect(md).toContain('**`POST`** `/api/pet`')
    expect(md).not.toContain('## Parameters')
    // The referencedModels section should still render (Pet is referenced).
    expect(md).toContain('### `Pet`')
  })

  it('surfaces extra keys for Postman/Bruno style auth and scripts', () => {
    const doc = makeGrpcDoc()
    const firstOp = doc.operations[0]
    if (!firstOp) throw new Error('fixture must expose an operation')
    const md = compileOperationMarkdown(doc, firstOp)
    expect(md).toContain('## Additional info')
    expect(md).toContain('- **callType:** `unary`')
  })
})

describe('compileGroupMarkdown', () => {
  it('renders group description and the list of operations in the group', () => {
    const doc = makeSwaggerDoc()
    const md = compileGroupMarkdown(doc, 'pet')
    expect(md).toContain('# pet')
    expect(md).toContain('Pet operations')
    expect(md).toContain('**`GET`** `/api/pet/{petId}`')
    expect(md).toContain('Find pet by ID')
  })

  it('returns empty string for a non-existing group', () => {
    const doc = makeSwaggerDoc()
    expect(compileGroupMarkdown(doc, 'ghost')).toBe('')
  })
})

describe('compileRootMarkdown', () => {
  it('renders API title, server info and group summaries', () => {
    const doc = makeSwaggerDoc()
    const md = compileRootMarkdown(doc)
    expect(md).toContain('# Petstore')
    expect(md).toContain('**Version:** `1.0.0`')
    expect(md).toContain('## Server')
    expect(md).toContain('- **Host:** `petstore.example.com`')
    expect(md).toContain('- **Base path:** `/api`')
    expect(md).toContain('### pet')
  })
})

describe('compileDocumentationForRoute', () => {
  it('returns compiled markdown + matched operation when the route matches', () => {
    const doc = makeSwaggerDoc()
    const out = compileDocumentationForRoute(doc, {
      type: 'http',
      url: '{{baseUrl}}/pet/{{petId}}',
      method: 'GET'
    })
    if (!out) throw new Error('expected a matched operation')
    expect(out.operation.operationId).toBe('getPetById')
    expect(out.markdown).toContain('# Find pet by ID')
  })

  it('returns undefined when no operation matches (e.g., a user-added request)', () => {
    const doc = makeSwaggerDoc()
    const out = compileDocumentationForRoute(doc, {
      type: 'http',
      url: 'https://other.example.com/custom',
      method: 'GET'
    })
    expect(out).toBeUndefined()
  })
})
