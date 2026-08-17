import { describe, it, expect } from 'vitest'
import {
  apiKeyHeaderName,
  authSatisfied,
  buildListPage,
  buildModelInstance,
  compileDesignRoutes,
  defaultResponseCode,
  effectiveAuth,
  matchDesignRoute,
  servedProperties,
  servedTotal,
  validateBodyAgainstModel
} from '../../src/shared/design/designServing'
import { buildReferenceApiDesign } from './apiDesignReference'
import type { ApiDesign, DesignRoute } from '../../src/shared/types/apiDesign'

// The pure half of the design server. These tests are the service's
// spec: the main-process HTTP shell adds transport (ports, latency,
// counters) but every routing / auth / payload decision is pinned here.
describe('designServing', () => {
  const design = buildReferenceApiDesign()
  const group = design.routeGroups[0]
  if (group === undefined) throw new Error('reference fixture group missing')
  const route = (id: string): DesignRoute => {
    const found = group.routes.find((r) => r.id === id)
    if (found === undefined) throw new Error(`fixture route ${id} missing`)
    return found
  }
  const userModel = design.models.find((m) => m.id === 'model-user')
  const orderModel = design.models.find((m) => m.id === 'model-order')
  const adminModel = design.models.find((m) => m.id === 'model-admin')
  if (userModel === undefined || orderModel === undefined || adminModel === undefined) {
    throw new Error('reference fixture models missing')
  }

  describe('route table', () => {
    const table = compileDesignRoutes(design)

    it('composes design base path + version prefix + group base path', () => {
      expect(table.map((e) => `${e.method} ${e.pattern}`)).toEqual([
        'GET /api/v1/users/{{id}}',
        'GET /api/v1/users',
        'POST /api/v1/users'
      ])
    })

    it('matches a parameterized path and decodes the captured value', () => {
      const match = matchDesignRoute(table, 'get', '/api/v1/users/ada%40example.com')
      expect(match?.entry.route.id).toBe('route-user-get')
      expect(match?.params).toEqual({ id: 'ada@example.com' })
    })

    it('separates routes by method on the same path', () => {
      expect(matchDesignRoute(table, 'GET', '/api/v1/users')?.entry.route.id).toBe('route-user-list')
      expect(matchDesignRoute(table, 'POST', '/api/v1/users')?.entry.route.id).toBe('route-user-create')
    })

    it('returns null for an unknown path or method', () => {
      expect(matchDesignRoute(table, 'GET', '/api/v2/users')).toBeNull()
      expect(matchDesignRoute(table, 'DELETE', '/api/v1/users')).toBeNull()
    })

    it('prefers exact literal segments over parameter captures', () => {
      const withLiteral: ApiDesign = structuredClone(design)
      withLiteral.routeGroups[0]?.routes.push({
        id: 'route-user-me',
        doc: { match: { urlPattern: '/me', method: 'GET' }, responses: { '200': { description: 'Me.' } } }
      })
      const richer = compileDesignRoutes(withLiteral)
      expect(matchDesignRoute(richer, 'GET', '/api/v1/users/me')?.entry.route.id).toBe('route-user-me')
      expect(matchDesignRoute(richer, 'GET', '/api/v1/users/42')?.entry.route.id).toBe('route-user-get')
    })
  })

  describe('auth', () => {
    it('resolves route override > group auth > design default > none', () => {
      expect(effectiveAuth(design, group, route('route-user-create'))).toBe('none')
      expect(effectiveAuth(design, group, route('route-user-get'))).toBe('bearer')
      const bare: ApiDesign = structuredClone(design)
      delete bare.routeGroups[0]?.design?.auth
      delete bare.routeGroups[0]?.routes[0]?.design?.authOverride
      const bareGroup = bare.routeGroups[0]
      const bareRoute = bareGroup?.routes[0]
      if (bareGroup === undefined || bareRoute === undefined) throw new Error('clone lost its group')
      expect(effectiveAuth(bare, bareGroup, bareRoute)).toBe('bearer')
      delete bare.defaultAuth
      expect(effectiveAuth(bare, bareGroup, bareRoute)).toBe('none')
    })

    it('reads the apiKey header name from the declared scheme, X-API-Key otherwise', () => {
      expect(apiKeyHeaderName(design)).toBe('X-API-Key')
      const withApiKey: ApiDesign = structuredClone(design)
      withApiKey.securitySchemes = { keyAuth: { type: 'apiKey', in: 'header', name: 'X-Petstore-Key' } }
      expect(apiKeyHeaderName(withApiKey)).toBe('X-Petstore-Key')
    })

    it('checks credential PRESENCE, not validity', () => {
      expect(authSatisfied('none', {}, design)).toBe(true)
      expect(authSatisfied('bearer', { authorization: 'Bearer anything' }, design)).toBe(true)
      expect(authSatisfied('bearer', { authorization: 'Bearer' }, design)).toBe(false)
      expect(authSatisfied('bearer', {}, design)).toBe(false)
      expect(authSatisfied('basic', { authorization: 'Basic dXNlcjpwdw==' }, design)).toBe(true)
      expect(authSatisfied('basic', { authorization: 'Bearer tok' }, design)).toBe(false)
      expect(authSatisfied('apiKeyHeader', { 'x-api-key': 'k' }, design)).toBe(true)
      expect(authSatisfied('apiKeyHeader', { 'x-api-key': '  ' }, design)).toBe(false)
    })
  })

  describe('served instances', () => {
    it('serves the inheritance chain root-first, then own properties', () => {
      const names = servedProperties(design, adminModel).map((p) => p.property.doc.name)
      expect(names).toEqual(['id', 'email', 'password', 'status', 'nicknames', 'settings', 'scope'])
    })

    it('is deterministic for a given seed key and honours doc examples', () => {
      const first = buildModelInstance(design, userModel, { seedKey: 'list:0' })
      const second = buildModelInstance(design, userModel, { seedKey: 'list:0' })
      expect(second).toEqual(first)
      expect(first['email']).toBe('ada@example.com')
      const other = buildModelInstance(design, userModel, { seedKey: 'list:1' })
      expect(other['id']).not.toEqual(first['id'])
    })

    it('applies a named example\'s defined values over everything else', () => {
      const instance = buildModelInstance(design, userModel, { exampleId: 'example-user-admin', seedKey: 'x' })
      expect(instance['email']).toBe('admin@example.com')
      expect(instance['status']).toBe('active')
    })

    it('nests a model-referenced property one level, without recursion', () => {
      const instance = buildModelInstance(design, orderModel, { seedKey: 'one' })
      const customer = instance['customer'] as Record<string, unknown>
      expect(typeof customer).toBe('object')
      expect(typeof customer['email']).toBe('string')
    })
  })

  describe('pagination', () => {
    it('maps the volumetry intent to the reported total', () => {
      expect(servedTotal(userModel)).toBe(10_000)
      expect(servedTotal(orderModel)).toBe(1_000_000)
      expect(servedTotal(adminModel)).toBe(25)
    })

    it('serves named examples first, clamps limit and honours offset', () => {
      const listRoute = route('route-user-list')
      const page = buildListPage(design, userModel, listRoute, {})
      expect(page.total).toBe(10_000)
      expect(page.limit).toBe(20)
      expect(page.offset).toBe(0)
      expect(page.items).toHaveLength(20)
      expect(page.items[0]?.['email']).toBe('admin@example.com')

      const clamped = buildListPage(design, userModel, listRoute, { limit: '5000', offset: '30' })
      expect(clamped.limit).toBe(100)
      expect(clamped.offset).toBe(30)

      const garbage = buildListPage(design, userModel, listRoute, { limit: 'abc', offset: '-2' })
      expect(garbage.limit).toBe(20)
      expect(garbage.offset).toBe(0)
    })
  })

  describe('body validation', () => {
    it('rejects a non-object body outright', () => {
      expect(validateBodyAgainstModel(design, userModel, [1, 2])).toEqual([
        { property: '', code: 'notAnObject' }
      ])
    })

    it('reports missing required properties, skipping read-only ones', () => {
      const issues = validateBodyAgainstModel(design, userModel, {})
      expect(issues).toEqual([
        { property: 'email', code: 'required' },
        { property: 'password', code: 'required' }
      ])
    })

    it('reports constraint violations on provided values', () => {
      const issues = validateBodyAgainstModel(design, userModel, {
        email: 'ada@example.com',
        password: 'short'
      })
      expect(issues).toEqual([
        { property: 'password', code: 'constraint', detail: 'minLength' }
      ])
    })
  })

  it('defaults to the lowest declared 2xx status code', () => {
    expect(defaultResponseCode(route('route-user-get'))).toBe('200')
    expect(defaultResponseCode(route('route-user-create'))).toBe('201')
    expect(defaultResponseCode({ id: 'r', doc: { match: { urlPattern: '/x' }, responses: { '404': {} } } })).toBe('200')
  })
})
