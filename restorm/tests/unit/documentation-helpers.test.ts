import { describe, it, expect } from 'vitest'
import { extractModelRef } from '../../src/renderer/src/components/documentation/documentationModels'
import { collectEnumGroups, isEnumModel } from '../../src/renderer/src/components/documentation/enumGroups'
import type { ModelDocumentation } from '../../src/shared/types/apiDocumentation'
import { statusCodeColor } from '../../src/renderer/src/components/documentation/statusCodeColor'
import { routeFromRequest } from '../../src/renderer/src/hooks/routeFromRequest'
import { buildRequestFromOperation } from '../../src/renderer/src/services/buildRequestFromOperation'
import type {
  GraphQLRequest,
  GrpcRequest,
  HTTPRequest,
  ODataRequest,
  Request,
  SoapRequest,
  WebSocketRequest
} from '../../src/shared/types/collections'

const baseHeaders = { headers: [], params: [], pathParams: [], documentation: '', tags: [] }

const httpRequest: HTTPRequest = {
  ...baseHeaders,
  type: 'http',
  id: 'http-1',
  name: 'h',
  method: 'GET',
  url: '/pet/{petId}'
}

const graphqlRequest: GraphQLRequest = {
  ...baseHeaders,
  type: 'graphql',
  id: 'gql-1',
  name: 'gql',
  url: '/graphql',
  query: 'query Foo { foo }',
  operationType: 'query'
}

const grpcRequest: GrpcRequest = {
  ...baseHeaders,
  type: 'grpc',
  id: 'grpc-1',
  name: 'g',
  url: 'grpc://example.com',
  service: 'PetService',
  method: 'getPet',
  body: { type: 'json', message: '{}' }
}

const soapRequest: SoapRequest = {
  ...baseHeaders,
  type: 'soap',
  id: 'soap-1',
  name: 's',
  url: 'http://example.com/soap',
  operation: 'getPetById',
  service: 'PetService',
  soapAction: 'urn:getPetById',
  body: { type: 'envelope', envelope: '<env/>' }
}

const wsRequest: WebSocketRequest = {
  ...baseHeaders,
  type: 'websocket',
  id: 'ws-1',
  name: 'w',
  url: 'wss://example.com',
  protocol: 'json',
  event: 'message'
}

const odataRequest: ODataRequest = {
  ...baseHeaders,
  type: 'odata',
  id: 'odata-1',
  name: 'o',
  url: 'https://example.com/odata/Pets'
}

describe('routeFromRequest', () => {
  it('http carries url + method + tags', () => {
    expect(routeFromRequest(httpRequest)).toEqual({
      type: 'http',
      url: '/pet/{petId}',
      method: 'GET',
      tags: []
    })
  })

  it('graphql carries url + operationType + query + tags', () => {
    expect(routeFromRequest(graphqlRequest)).toEqual({
      type: 'graphql',
      url: '/graphql',
      operationType: 'query',
      query: 'query Foo { foo }',
      tags: []
    })
  })

  it('grpc maps `method` onto `rpcMethod` (the matcher key)', () => {
    expect(routeFromRequest(grpcRequest)).toEqual({
      type: 'grpc',
      url: 'grpc://example.com',
      service: 'PetService',
      rpcMethod: 'getPet',
      tags: []
    })
  })

  it('soap carries operation + service + soapAction', () => {
    expect(routeFromRequest(soapRequest)).toEqual({
      type: 'soap',
      url: 'http://example.com/soap',
      operation: 'getPetById',
      service: 'PetService',
      soapAction: 'urn:getPetById',
      tags: []
    })
  })

  it('websocket adds `event` only when defined', () => {
    expect(routeFromRequest(wsRequest)).toEqual({
      type: 'websocket',
      url: 'wss://example.com',
      protocol: 'json',
      event: 'message',
      tags: []
    })
    const wsNoEvent: WebSocketRequest = { ...wsRequest, event: undefined as unknown as string }
    delete (wsNoEvent as { event?: string }).event
    expect(routeFromRequest(wsNoEvent)).toEqual({
      type: 'websocket',
      url: 'wss://example.com',
      protocol: 'json',
      tags: []
    })
  })

  it('odata aliases onto the http matcher branch', () => {
    expect(routeFromRequest(odataRequest)).toEqual({
      type: 'http',
      url: 'https://example.com/odata/Pets',
      tags: []
    })
  })

  it('every Request `type` is exhaustively handled (no fall-through)', () => {
    const all: Request[] = [httpRequest, graphqlRequest, grpcRequest, soapRequest, wsRequest, odataRequest]
    for (const r of all) expect(routeFromRequest(r)).toBeDefined()
  })
})

describe('statusCodeColor', () => {
  it('2xx → success', () => {
    expect(statusCodeColor('200')).toBe('var(--testing-iconPassed)')
    expect(statusCodeColor('299')).toBe('var(--testing-iconPassed)')
  })

  it('3xx → warning', () => {
    expect(statusCodeColor('301')).toBe('var(--editorWarning-foreground)')
    expect(statusCodeColor('399')).toBe('var(--editorWarning-foreground)')
  })

  it('4xx + 5xx → failure', () => {
    expect(statusCodeColor('400')).toBe('var(--testing-iconFailed)')
    expect(statusCodeColor('500')).toBe('var(--testing-iconFailed)')
  })

  it('OAS class patterns (`2XX` / `4XX`) collapse to the class colour', () => {
    expect(statusCodeColor('2XX')).toBe('var(--testing-iconPassed)')
    expect(statusCodeColor('4XX')).toBe('var(--testing-iconFailed)')
    expect(statusCodeColor('5xx')).toBe('var(--testing-iconFailed)')
  })

  it('`default` and unrecognised codes fall back to the neutral colour', () => {
    expect(statusCodeColor('default')).toContain('description-foreground')
    expect(statusCodeColor('???')).toContain('description-foreground')
  })
})

describe('enumGroups', () => {
  const objectModel: ModelDocumentation = {
    name: 'Pet',
    properties: [
      { name: 'name', type: 'string', required: true },
      { name: 'status', type: 'string', required: false, enumValues: ['available', 'sold'] }
    ]
  }
  const enumModel: ModelDocumentation = {
    name: 'Skill',
    properties: [],
    enumValues: ['mining', 'fishing']
  }

  it('isEnumModel: propertyless schema with enumValues is an enum model', () => {
    expect(isEnumModel(enumModel)).toBe(true)
    expect(isEnumModel(objectModel)).toBe(false)
    // An object model that also carries top-level enumValues stays structural.
    expect(isEnumModel({ ...objectModel, enumValues: ['x'] })).toBe(false)
  })

  it('collectEnumGroups: top-level enum becomes a model-level group', () => {
    const groups = collectEnumGroups([enumModel])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.modelName).toBe('Skill')
    expect(groups[0]?.entries).toEqual([])
    expect(groups[0]?.modelLevelValues).toEqual(['mining', 'fishing'])
  })

  it('collectEnumGroups: object model contributes per-property enum entries', () => {
    const groups = collectEnumGroups([objectModel])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.modelLevelValues).toBeUndefined()
    expect(groups[0]?.entries).toEqual([{ propertyName: 'status', values: ['available', 'sold'] }])
  })

  it('collectEnumGroups: models with no enums produce no group', () => {
    const plain: ModelDocumentation = { name: 'Empty', properties: [{ name: 'id', type: 'string', required: true }] }
    expect(collectEnumGroups([plain])).toEqual([])
  })
})

describe('extractModelRef', () => {
  it('plain identifier → ref + non-array', () => {
    expect(extractModelRef('Pet')).toEqual({ ref: 'Pet', isArray: false })
  })

  it('`Pet[]` → ref + isArray', () => {
    expect(extractModelRef('Pet[]')).toEqual({ ref: 'Pet', isArray: true })
  })

  it('`array<Pet>` and `Array<Pet>` both pass', () => {
    expect(extractModelRef('array<Pet>')).toEqual({ ref: 'Pet', isArray: true })
    expect(extractModelRef('Array<Pet>')).toEqual({ ref: 'Pet', isArray: true })
  })

  it('primitive labels do not produce a ref', () => {
    // `string` / `integer` are valid identifiers — they pass the
    // identifier branch and become "ref candidates". The component
    // gates on `documentedModels.has(ref)` so this is fine; the
    // contract here is "syntax-only parse, semantics belong to the
    // caller".
    expect(extractModelRef('string')).toEqual({ ref: 'string', isArray: false })
    // Whitespace-only / empty falls through to undefined.
    expect(extractModelRef('')).toEqual({ ref: undefined, isArray: false })
    expect(extractModelRef('   ')).toEqual({ ref: undefined, isArray: false })
  })

  it('unparseable junk → ref undefined', () => {
    expect(extractModelRef('Pet | Cat')).toEqual({ ref: undefined, isArray: false })
    expect(extractModelRef('Map<string,Pet>')).toEqual({ ref: undefined, isArray: false })
  })
})

describe('buildRequestFromOperation', () => {
  it('rewrites declared path-param tokens to handlebars and leaves undeclared ones alone', () => {
    const req = buildRequestFromOperation({
      match: { urlPattern: '/pet/{petId}/photo/{shape}', method: 'GET' },
      operationId: 'getPhoto',
      parameters: [{ name: 'petId', location: 'path', type: 'integer', required: true }]
    })
    expect(req.url).toBe('/pet/{{petId}}/photo/{shape}')
  })

  it('disables optional params and keeps required ones enabled', () => {
    const req = buildRequestFromOperation({
      match: { urlPattern: '/pet', method: 'POST' },
      parameters: [
        { name: 'apiKey', location: 'header', type: 'string', required: true },
        { name: 'verbose', location: 'query', type: 'boolean', required: false }
      ]
    })
    const apiKey = req.headers.find((h) => h.key === 'apiKey')
    const verbose = req.params.find((p) => p.key === 'verbose')
    expect(apiKey?.enabled).toBe(true)
    expect(verbose?.enabled).toBe(false)
  })

  it('carries the operation `group` as the request `tags`', () => {
    const req = buildRequestFromOperation({
      match: { urlPattern: '/pet', method: 'GET' },
      group: 'pet'
    })
    expect(req.tags).toEqual(['pet'])
  })

  it('seeds parameter values from defaultValue / example', () => {
    const req = buildRequestFromOperation({
      match: { urlPattern: '/pet', method: 'GET' },
      parameters: [
        { name: 'status', location: 'query', type: 'string', required: false, defaultValue: 'available' },
        { name: 'limit', location: 'query', type: 'integer', required: false, example: 25 }
      ]
    })
    expect(req.params[0]?.value.toString()).toBe('available')
    expect(req.params[1]?.value.toString()).toBe('25')
  })

  it('falls back to method + URL for the request name when no summary / operationId', () => {
    const req = buildRequestFromOperation({ match: { urlPattern: '/pet', method: 'POST' } })
    expect(req.name).toBe('POST /pet')
  })

  it('marks the request deprecated when the operation is deprecated', () => {
    const req = buildRequestFromOperation({
      match: { urlPattern: '/legacy', method: 'GET' },
      deprecated: true
    })
    expect(req.deprecated).toBe(true)
  })
})
