import { describe, it, expect } from 'vitest'
import {
  routePathParams,
  syncPathParams,
  pluralize,
  identifierProperty,
  generateCrud,
  buildErrorModel,
  findErrorModel,
  withStandardErrorResponses,
  generateSearchParams,
  STANDARD_ERROR_CODES
} from '../../src/shared/design/designRoutes'
import { composeRoutePath } from '../../src/shared/design/apiDesignDoc'
import { buildReferenceApiDesign } from './apiDesignReference'

let counter = 0
const newId = (): string => `gen-${++counter}`

describe('designRoutes', () => {
  it('routePathParams extracts {{param}} names in order, deduplicated', () => {
    expect(routePathParams('/')).toEqual([])
    expect(routePathParams('/{{id}}')).toEqual(['id'])
    expect(routePathParams('/{{orgId}}/users/{{id}}/{{id}}')).toEqual(['orgId', 'id'])
  })

  it('composeRoutePath resolves the full path from every base segment', () => {
    expect(composeRoutePath({ designBasePath: '/api', versionPrefix: '/v1', groupBasePath: '/users' }, '/{{id}}'))
      .toBe('/api/v1/users/{{id}}')
    expect(composeRoutePath({}, '/')).toBe('/')
  })

  describe('syncPathParams — the request-editor mechanic', () => {
    const design = buildReferenceApiDesign()
    const route = design.routeGroups[0]?.routes[0]
    if (route === undefined) throw new Error('fixture route missing')

    it('typing a {{param}} creates its row; removing it drops the row AND its link', () => {
      const withTwo = syncPathParams(route, '/{{id}}/orders/{{orderId}}')
      expect(withTwo.doc.parameters?.filter((p) => p.location === 'path').map((p) => p.name)).toEqual(['id', 'orderId'])
      // The fixture's id row (and its link) survived; orderId is a fresh row.
      expect(withTwo.design?.paramLinks?.['id']?.propertyId).toBe('prop-user-id')

      const backToOne = syncPathParams(withTwo, '/{{orderId}}')
      expect(backToOne.doc.parameters?.filter((p) => p.location === 'path').map((p) => p.name)).toEqual(['orderId'])
      expect(backToOne.design?.paramLinks?.['id']).toBeUndefined()
    })

    it('leaves query/header parameters untouched', () => {
      const withQuery = {
        ...route,
        doc: { ...route.doc, parameters: [...(route.doc.parameters ?? []), { name: 'verbose', location: 'query', type: 'boolean', required: false }] }
      }
      const next = syncPathParams(withQuery, '/')
      expect(next.doc.parameters?.map((p) => p.name)).toEqual(['verbose'])
    })
  })

  it('pluralize covers the common English endings', () => {
    expect(pluralize('User')).toBe('Users')
    expect(pluralize('Box')).toBe('Boxes')
    expect(pluralize('Category')).toBe('Categories')
    expect(pluralize('Status')).toBe('Statuses')
  })

  it('identifierProperty prefers the declared identifier, then a property named id', () => {
    const design = buildReferenceApiDesign()
    const user = design.models.find((m) => m.id === 'model-user')
    const admin = design.models.find((m) => m.id === 'model-admin')
    if (user === undefined || admin === undefined) throw new Error('fixture models missing')
    expect(identifierProperty(user)?.id).toBe('prop-user-id')
    expect(identifierProperty(admin)).toBeUndefined()
  })

  describe('generateCrud — the five-route convention', () => {
    const design = buildReferenceApiDesign()
    const user = design.models.find((m) => m.id === 'model-user')
    if (user === undefined) throw new Error('fixture model missing')
    const { group } = generateCrud(design, user, newId)

    it('names the group after the plural and bases it accordingly', () => {
      expect(group.doc.name).toBe('Users')
      expect(group.design?.basePath).toBe('/users')
      expect(group.routes).toHaveLength(5)
    })

    it('produces list/read/create/update/delete with the expected contracts', () => {
      const byKey = (method: string, pattern: string): (typeof group.routes)[number] | undefined =>
        group.routes.find((r) => r.doc.match.method === method && r.doc.match.urlPattern === pattern)

      const list = byKey('GET', '/')
      expect(list?.design?.responses?.['200']).toEqual({ modelId: user.id, list: true, paginated: true })
      expect(list?.design?.pagination).toEqual({ style: 'offset', defaultLimit: 20, maxLimit: 100 })

      const read = byKey('GET', '/{{id}}')
      expect(read?.design?.responses?.['200']?.modelId).toBe(user.id)
      expect(read?.design?.paramLinks?.['id']).toEqual({ modelId: user.id, propertyId: 'prop-user-id', descriptionAuto: true })
      expect(read?.doc.parameters?.[0]).toMatchObject({ name: 'id', location: 'path', required: true, type: 'string', format: 'uuid' })

      const create = byKey('POST', '/')
      expect(create?.design?.body).toEqual({ modelId: user.id, contentType: 'application/json' })
      expect(create?.design?.responses?.['201']?.modelId).toBe(user.id)

      const update = byKey('PUT', '/{{id}}')
      expect(update?.design?.body?.modelId).toBe(user.id)
      expect(update?.design?.paramLinks?.['id']?.propertyId).toBe('prop-user-id')

      const remove = byKey('DELETE', '/{{id}}')
      expect(remove?.doc.responses?.['204']).toBeDefined()
      expect(remove?.design?.paramLinks?.['id']?.propertyId).toBe('prop-user-id')
    })

    it('mints unique ids for the group and every route', () => {
      const ids = [group.id, ...group.routes.map((r) => r.id)]
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('standard errors', () => {
    it('buildErrorModel matches the agreed envelope, findErrorModel locates it', () => {
      const design = buildReferenceApiDesign()
      expect(findErrorModel(design)).toBeUndefined()
      const error = buildErrorModel(newId)
      expect(error.doc.name).toBe('Error')
      expect(error.properties.map((p) => [p.doc.name, p.doc.type, p.doc.required])).toEqual([
        ['code', 'string', true],
        ['message', 'string', true],
        ['details', 'string', false]
      ])
      const withError = { ...design, models: [...design.models, error] }
      expect(findErrorModel(withError)?.id).toBe(error.id)
    })

    it('withStandardErrorResponses adds 400/401/404/500 without clobbering declared codes', () => {
      const design = buildReferenceApiDesign()
      const route = design.routeGroups[0]?.routes[0]
      if (route === undefined) throw new Error('fixture route missing')
      const before404 = route.doc.responses?.['404']
      const next = withStandardErrorResponses(route, 'error-model')
      for (const code of STANDARD_ERROR_CODES) {
        expect(next.doc.responses?.[code]).toBeDefined()
      }
      // The route already declared its own 404 — untouched, no Error model bound.
      expect(next.doc.responses?.['404']).toEqual(before404)
      expect(next.design?.responses?.['404']).toBeUndefined()
      expect(next.design?.responses?.['400']?.modelId).toBe('error-model')
      // The declared 200 keeps its design meta.
      expect(next.design?.responses?.['200']?.modelId).toBe('model-user')
    })
  })

  describe('generateSearchParams — one linked query param per searchable property', () => {
    it('reuses the existing list route of the model and adds the params', () => {
      const design = buildReferenceApiDesign()
      const user = design.models.find((m) => m.id === 'model-user')
      if (user === undefined) throw new Error('fixture model missing')

      const { routeGroups, changed } = generateSearchParams(design, user, newId)
      expect(changed).toBe(true)
      // The fixture's route-user-list already returns a paginated User
      // list — the params land there, no new group.
      expect(routeGroups.map((g) => g.id)).toEqual(design.routeGroups.map((g) => g.id))
      const list = routeGroups.flatMap((g) => g.routes).find((r) => r.id === 'route-user-list')
      expect(list?.doc.parameters?.some((p) => p.name === 'email' && p.location === 'query' && !p.required)).toBe(true)
      expect(list?.design?.paramLinks?.['email']).toEqual({ modelId: user.id, propertyId: 'prop-user-email', descriptionAuto: true })
    })

    it('is idempotent — a second run changes nothing', () => {
      const design = buildReferenceApiDesign()
      const user = design.models.find((m) => m.id === 'model-user')
      if (user === undefined) throw new Error('fixture model missing')
      const first = generateSearchParams(design, user, newId)
      const again = generateSearchParams({ ...design, routeGroups: first.routeGroups }, user, newId)
      expect(again.changed).toBe(false)
    })

    it('creates the group and list route when the model has none', () => {
      const design = buildReferenceApiDesign()
      const order = design.models.find((m) => m.id === 'model-order')
      if (order === undefined) throw new Error('fixture model missing')
      // Make a property searchable so the generator has work.
      const searchable = {
        ...order,
        properties: order.properties.map((p) => (p.id === 'prop-order-id' ? { ...p, design: { ...(p.design ?? {}), searchable: true } } : p))
      }
      const base = { ...design, models: design.models.map((m) => (m.id === order.id ? searchable : m)) }
      const { routeGroups, changed } = generateSearchParams(base, searchable, newId)
      expect(changed).toBe(true)
      const group = routeGroups.find((g) => g.doc.name === 'Orders')
      expect(group?.design?.basePath).toBe('/orders')
      const list = group?.routes.find((r) => r.doc.match.method === 'GET')
      expect(list?.design?.responses?.['200']?.list).toBe(true)
      expect(list?.design?.paramLinks?.['id']?.propertyId).toBe('prop-order-id')
    })
  })
})
