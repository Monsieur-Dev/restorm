import { describe, it, expect } from 'vitest'
import { buildRequestFromOperation, resolveBaseUrlPrefix } from './buildRequestFromOperation'
import { NumericValue, DateTimeValue, ExpressionValue, StringValue } from '../../../shared/types/collections'
import type { OperationDocumentation, ModelDocumentation, ApiDocumentation } from '../../../shared/types/apiDocumentation'
import type { Environment } from '../../../shared/types/baseTypes'

/**
 * A request built from the documentation viewer must match what a normal import
 * produces: typed parameter values (an `integer` path param is a number, not a
 * string) and a pre-filled body reconstructed from the referenced model.
 */
describe('buildRequestFromOperation — import parity', () => {
  it('gives an integer path param a NumericValue (petId is int, not string)', () => {
    const op: OperationDocumentation = {
      match: { urlPattern: '/pet/{petId}', method: 'GET' },
      summary: 'Find pet by id',
      parameters: [{ name: 'petId', location: 'path', type: 'integer', required: true }]
    }
    const req = buildRequestFromOperation(op)
    expect(req.url).toBe('/pet/{{petId}}')
    const petId = (req.pathParams ?? []).find((p) => p.key === 'petId')
    expect(petId?.value).toBeInstanceOf(NumericValue)
  })

  it('maps a date-time query param to a DateTimeValue', () => {
    const op: OperationDocumentation = {
      match: { urlPattern: '/events', method: 'GET' },
      parameters: [{ name: 'since', location: 'query', type: 'string', format: 'date-time', required: false }]
    }
    const req = buildRequestFromOperation(op)
    expect(req.params.find((p) => p.key === 'since')?.value).toBeInstanceOf(DateTimeValue)
  })

  it('reconstructs the request body from the referenced model (Updated user gets a body)', () => {
    const models = new Map<string, ModelDocumentation>([
      ['User', {
        name: 'User',
        properties: [
          { name: 'id', type: 'integer', required: true },
          { name: 'username', type: 'string', required: true },
          { name: 'address', type: 'Address', required: false, targetModelRef: 'Address' }
        ]
      }],
      ['Address', {
        name: 'Address',
        properties: [{ name: 'city', type: 'string', required: false }]
      }]
    ])
    const op: OperationDocumentation = {
      match: { urlPattern: '/user/{username}', method: 'PUT' },
      summary: 'Updated user',
      parameters: [
        { name: 'username', location: 'path', type: 'string', required: true },
        { name: 'body', location: 'body', type: 'User', required: true }
      ]
    }
    const req = buildRequestFromOperation(op, models)
    expect(req.body).toBeDefined()
    expect(req.body?.type).toBe('text')
    const parsed = JSON.parse((req.body as { type: 'text'; content: string }).content) as Record<string, unknown>
    expect(parsed).toMatchObject({ id: 0, username: '', address: { city: '' } })
    // The body param must NOT leak into the query/header/path KV columns.
    expect(req.params.some((p) => p.key === 'body')).toBe(false)
    expect(req.headers.some((p) => p.key === 'body')).toBe(false)
  })

  it('leaves a bodyless operation without a body', () => {
    const op: OperationDocumentation = {
      match: { urlPattern: '/pet/{petId}', method: 'GET' },
      parameters: [{ name: 'petId', location: 'path', type: 'integer', required: true }]
    }
    expect(buildRequestFromOperation(op).body).toBeUndefined()
  })

  it('prepends the base-URL prefix to the path when one is supplied', () => {
    const op: OperationDocumentation = {
      match: { urlPattern: '/pet/{petId}', method: 'GET' },
      parameters: [{ name: 'petId', location: 'path', type: 'integer', required: true }]
    }
    expect(buildRequestFromOperation(op, new Map(), '{{baseUrl}}').url).toBe('{{baseUrl}}/pet/{{petId}}')
  })
})

describe('resolveBaseUrlPrefix — match the API URL variable by value', () => {
  const server: ApiDocumentation['server'] = { host: 'petstore.swagger.io', basePath: '/v2', schemes: ['https'] }
  const rootEnv = (variables: Environment['variables']): Environment[] => [{ id: 'e1', name: 'default', variables }]

  it('matches a root variable whose value is the API base URL (name = baseUrl)', () => {
    const envs = rootEnv([{ key: 'baseUrl', value: new ExpressionValue('https://petstore.swagger.io/v2'), enabled: true }])
    expect(resolveBaseUrlPrefix(envs, server)).toBe('{{baseUrl}}')
  })

  it('matches by value even when the variable is renamed (not baseUrl)', () => {
    const envs = rootEnv([{ key: 'apiRoot', value: new ExpressionValue('https://petstore.swagger.io/v2/'), enabled: true }])
    expect(resolveBaseUrlPrefix(envs, server)).toBe('{{apiRoot}}')
  })

  it('resolves the structured baseUrl template (scheme/host/port/baseRoute) an import seeds', () => {
    // This is the exact shape the Swagger/OpenAPI import writes: baseUrl is a
    // template referencing sibling variables, not a literal URL.
    const structuredServer: ApiDocumentation['server'] = { host: 'localhost:8080', basePath: '/api', schemes: ['https', 'http'] }
    const envs = rootEnv([
      { key: 'scheme', value: new StringValue('https'), enabled: true },
      { key: 'host', value: new StringValue('localhost'), enabled: true },
      { key: 'port', value: new NumericValue(8080, 'decimal'), enabled: true },
      { key: 'baseRoute', value: new StringValue('/api'), enabled: true },
      { key: 'baseUrl', value: new ExpressionValue('{{scheme}}://{{host}}:{{port}}{{baseRoute}}'), enabled: true }
    ])
    expect(resolveBaseUrlPrefix(envs, structuredServer)).toBe('{{baseUrl}}')
  })

  it('returns undefined when no root variable points at the API URL', () => {
    const envs = rootEnv([{ key: 'token', value: new StringValue('abc123'), enabled: true }])
    expect(resolveBaseUrlPrefix(envs, server)).toBeUndefined()
  })

  it('does not recurse into sub-environments (root only)', () => {
    const envs: Environment[] = [{
      id: 'e1', name: 'default', variables: [{ key: 'token', value: new StringValue('abc123'), enabled: true }],
      subEnvironments: [{ id: 'e2', name: 'prod', variables: [{ key: 'baseUrl', value: new ExpressionValue('https://petstore.swagger.io/v2'), enabled: true }] }]
    }]
    expect(resolveBaseUrlPrefix(envs, server)).toBeUndefined()
  })

  it('returns undefined when the API has no server host', () => {
    const envs = rootEnv([{ key: 'baseUrl', value: new ExpressionValue('https://petstore.swagger.io/v2'), enabled: true }])
    expect(resolveBaseUrlPrefix(envs, undefined)).toBeUndefined()
  })
})
