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
