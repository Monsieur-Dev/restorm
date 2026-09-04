/**
 * Regression coverage for the projection/round-trip fixes surfaced by the
 * m-14 branch audit — each asserts one specific defect stays fixed. These
 * exercise shapes the rich `apiDesignReference` fixture does NOT (canonical
 * `type:'array'` properties, sanitize-colliding names, inline enums, array
 * bodies), which is why the goldens missed them.
 */

import { describe, it, expect } from 'vitest'
import type { ApiDesign } from '../../src/shared/types/apiDesign'
import { designToApiDocumentation } from '../../src/shared/design/apiDesignDoc'
import { apiDocumentationToOpenApi } from '../../src/shared/design/openApiExport'
import { designToGraphqlSdl } from '../../src/shared/design/graphqlProjection'
import { designToCsdl } from '../../src/shared/design/odataProjection'
import { designToProto } from '../../src/shared/design/grpcProjection'
import { openapi3ToApiDocumentation, type OAS3Spec } from '../../src/main/services/import/transformers/openapi3ToApiDocumentation'

type Property = ApiDesign['models'][number]['properties'][number]

interface OasLite {
  components: { schemas: Record<string, { properties?: Record<string, unknown>; deprecated?: boolean }> }
}

function design(models: ApiDesign['models'], routeGroups: ApiDesign['routeGroups'] = []): ApiDesign {
  return {
    type: 'design',
    id: 'd1',
    name: 'D',
    info: { title: 'D', version: '1.0.0' },
    models,
    enums: [],
    routeGroups
  }
}

function model(name: string, properties: Property[], extra: Partial<ApiDesign['models'][number]['doc']> = {}): ApiDesign['models'][number] {
  return { id: `model-${name}`, doc: { name, ...extra }, properties }
}

describe('projection fixes', () => {
  it('a canonical primitive-array property exports with OpenAPI `items` (not a typeless array)', () => {
    const d = design([
      model('User', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'nicknames', type: 'array' }, design: { arrayItems: { type: 'string' } } }
      ])
    ])
    const oas = apiDocumentationToOpenApi(designToApiDocumentation(d)) as unknown as OasLite
    const nick = oas.components.schemas.User.properties?.nicknames
    expect(nick).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('GraphQL de-dupes fields whose names sanitize alike (no duplicate → schema builds)', () => {
    const d = design([
      model('Thing', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'order-id', type: 'string' } },
        { id: 'p3', doc: { name: 'order.id', type: 'string' } }
      ])
    ])
    const sdl = designToGraphqlSdl(d)
    // Both collide on `order_id`; the second must be uniquified.
    expect(sdl).toContain('order_id:')
    expect(sdl).toContain('order_id_2:')
    // …and never the same field name twice within the type.
    const dupes = sdl.split('\n').filter((l) => l.trim().startsWith('order_id:'))
    expect(dupes.length).toBe(1)
  })

  it('OData sanitizes property + key names to valid EDM identifiers', () => {
    const d = design([
      model('Thing', [
        { id: 'p1', doc: { name: 'order-id', type: 'string', required: true } }
      ])
    ])
    const csdl = designToCsdl(d)
    expect(csdl).toContain('Name="order_id"')
    expect(csdl).not.toContain('Name="order-id"')
  })

  it('GraphQL synthesizes a named enum type for an INLINE property enum', () => {
    const d = design([
      model('Order', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'status', type: 'string', enumValues: ['open', 'closed'] } }
      ])
    ])
    const sdl = designToGraphqlSdl(d)
    expect(sdl).toContain('enum OrderStatus {')
    expect(sdl).toMatch(/status: OrderStatus/)
    expect(sdl).toContain('open')
    expect(sdl).toContain('closed')
  })

  it('OData synthesizes an EnumType for an INLINE property enum', () => {
    const d = design([
      model('Order', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'status', type: 'string', enumValues: ['open', 'closed'] } }
      ])
    ])
    const csdl = designToCsdl(d)
    expect(csdl).toMatch(/<EnumType Name="Order_status">/)
    expect(csdl).toMatch(/<Property Name="status" Type="[^"]*\.Order_status"/)
    expect(csdl).toMatch(/<Member Name="open"/)
  })

  it('gRPC surfaces an INLINE property enum as a comment', () => {
    const d = design([
      model('Order', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'status', type: 'string', enumValues: ['open', 'closed'] } }
      ])
    ])
    const proto = designToProto(d)
    expect(proto).toContain('// enum: open | closed')
  })

  it('OpenAPI emits `deprecated` on a deprecated model', () => {
    const d = design([
      model('Legacy', [{ id: 'p1', doc: { name: 'id', type: 'string' } }], { deprecated: true })
    ])
    const oas = apiDocumentationToOpenApi(designToApiDocumentation(d)) as unknown as OasLite
    expect(oas.components.schemas.Legacy.deprecated).toBe(true)
  })

  it('deprecation on a model, property and parameter survives the OpenAPI round-trip', () => {
    const d = design(
      [model('Legacy', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'old', type: 'string', deprecated: true } }
      ], { deprecated: true })],
      [{
        id: 'g1',
        doc: { name: 'Legacies' },
        routes: [{
          id: 'r1',
          doc: {
            match: { method: 'GET', urlPattern: '/legacies' },
            summary: 'List',
            parameters: [{ name: 'q', location: 'query', type: 'string', required: false, deprecated: true }]
          }
        }]
      }]
    )
    const spec = apiDocumentationToOpenApi(designToApiDocumentation(d)) as unknown as OAS3Spec
    const reimported = openapi3ToApiDocumentation(spec)
    const legacy = reimported.models['Legacy']
    expect(legacy?.deprecated).toBe(true)
    expect(legacy?.properties.find((p) => p.name === 'old')?.deprecated).toBe(true)
    const param = reimported.operations[0]?.parameters?.find((p) => p.name === 'q')
    expect(param?.deprecated).toBe(true)
  })

  it('enum member names round-trip through OpenAPI x-enum-varnames', () => {
    const d: ApiDesign = {
      type: 'design', id: 'd1', name: 'D', info: { title: 'D', version: '1.0.0' },
      models: [model('User', [
        { id: 'p1', doc: { name: 'id', type: 'string', required: true } },
        { id: 'p2', doc: { name: 'status', type: 'string' }, design: { reference: { target: 'enum', refId: 'e1' } } }
      ])],
      enums: [{ id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['open', 'closed'] }, memberNames: ['OPEN', 'CLOSED'] }],
      routeGroups: []
    }
    const spec = apiDocumentationToOpenApi(designToApiDocumentation(d)) as unknown as OAS3Spec & { components?: { schemas?: Record<string, { 'x-enum-varnames'?: unknown }> } }
    expect(spec.components?.schemas?.Status?.['x-enum-varnames']).toEqual(['OPEN', 'CLOSED'])
    const reimported = openapi3ToApiDocumentation(spec)
    expect(reimported.models['Status']?.enumVarNames).toEqual(['OPEN', 'CLOSED'])
  })

  it('a request body keeps its array-ness on the design→doc projection', () => {
    const d = design(
      [model('User', [{ id: 'p1', doc: { name: 'id', type: 'string', required: true } }])],
      [{
        id: 'g1',
        doc: { name: 'Users' },
        routes: [{
          id: 'r1',
          doc: { match: { method: 'POST', urlPattern: '/users' }, summary: 'Bulk create' },
          design: { body: { modelId: 'model-User', list: true, contentType: 'application/json' } }
        }]
      }]
    )
    const doc = designToApiDocumentation(d)
    const op = doc.operations[0]
    const body = op?.parameters?.find((p) => p.location === 'body')
    expect(body?.type).toBe('array<User>')
  })
})
