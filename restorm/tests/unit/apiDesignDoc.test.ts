import { describe, it, expect } from 'vitest'
import {
  composeRoutePath,
  designModelDoc,
  designNameResolver,
  designToApiDocumentation
} from '../../src/shared/design/apiDesignDoc'
import type { ApiDocumentation } from '../../src/shared/types/apiDocumentation'
import { buildReferenceApiDesign } from './apiDesignReference'

describe('composeRoutePath', () => {
  it('joins the design, version and group bases with the relative pattern', () => {
    expect(composeRoutePath(
      { designBasePath: '/api', versionPrefix: '/v1', groupBasePath: '/users' },
      '/{{id}}'
    )).toBe('/api/v1/users/{{id}}')
  })

  it('tolerates missing segments and stray slashes', () => {
    expect(composeRoutePath({}, '/')).toBe('/')
    expect(composeRoutePath({ groupBasePath: 'users/' }, '{{id}}/')).toBe('/users/{{id}}')
    expect(composeRoutePath({ designBasePath: '' }, '/pets')).toBe('/pets')
  })
})

describe('designModelDoc', () => {
  it('reassembles a plain ModelDocumentation and derives targetModelRef from the ID reference', () => {
    const design = buildReferenceApiDesign()
    const resolve = designNameResolver(design)
    const order = design.models.find((m) => m.doc.name === 'Order')
    if (order === undefined) throw new Error('fixture has Order')

    const doc = designModelDoc(order, resolve)
    expect(doc.name).toBe('Order')
    expect(doc.properties.map((p) => p.name)).toEqual(['id', 'customer', 'lines'])
    expect(doc.properties[1]?.targetModelRef).toBe('User')
    expect(doc.properties[2]?.targetModelRef).toBe('User')
  })

  it('leaves the doc untouched on a dangling reference', () => {
    const design = buildReferenceApiDesign()
    const order = design.models.find((m) => m.doc.name === 'Order')
    if (order === undefined) throw new Error('fixture has Order')
    const customer = order.properties[1]
    if (customer?.design?.reference === undefined) throw new Error('fixture has the reference')
    customer.design.reference.refId = 'missing'
    customer.doc.targetModelRef = 'Stale'
    const doc = designModelDoc(order, designNameResolver(design))
    expect(doc.properties[1]?.targetModelRef).toBe('Stale')
  })
})

describe('designToApiDocumentation', () => {
  const projection = designToApiDocumentation(buildReferenceApiDesign())

  it('projects models and enums under their names', () => {
    expect(Object.keys(projection.models).sort()).toEqual(['AdminUser', 'Order', 'User', 'UserStatus'])
    expect(projection.models['UserStatus']?.enumValues).toEqual(['active', 'suspended', 'deleted'])
  })

  it('flattens routes onto operations with composed full paths and group tags', () => {
    const patterns = projection.operations.map((op) => `${op.match.method ?? ''} ${op.match.urlPattern}`)
    // No `/api` prefix: the design base path travels in `server.basePath`
    // (base-URL territory), never in operation paths — importer parity.
    expect(patterns).toEqual([
      'GET /v1/users/{{id}}',
      'GET /v1/users',
      'POST /v1/users'
    ])
    expect(projection.operations.every((op) => op.group === 'Users')).toBe(true)
    expect(Object.keys(projection.groups)).toEqual(['Users'])
  })

  it('carries the API identity, server, and security through verbatim', () => {
    const design = buildReferenceApiDesign()
    expect(projection.api).toEqual(design.info)
    expect(projection.server).toEqual(design.server)
    expect(projection.securitySchemes).toEqual(design.securitySchemes)
    expect(projection.defaultSecurity).toEqual(design.defaultSecurity)
  })

  /**
   * Coverage drift guard: every field of `ApiDocumentation` must have a
   * home in the design projection. If the documentation root ever gains
   * a field (a new thing importers can produce), this fails until the
   * design decides where that field lives — the compile-time half of
   * the importer-coverage audit.
   */
  it('covers every ApiDocumentation root field', () => {
    const covered: Record<keyof ApiDocumentation, true> = {
      sourceType: true,      // the design is the source; projection stamps a dialect
      sourceUrl: true,       // no remote source: deliberately absent on a design
      api: true,             // ApiDesign.info
      server: true,          // ApiDesign.server
      models: true,          // ApiDesign.models + enums
      groups: true,          // ApiDesign.routeGroups[].doc
      operations: true,      // ApiDesign.routeGroups[].routes[].doc
      securitySchemes: true, // ApiDesign.securitySchemes
      defaultSecurity: true  // ApiDesign.defaultSecurity
    }
    // The runtime half: the projection emits no key outside the doc type.
    for (const key of Object.keys(projection)) {
      expect(key in covered, `projection emits unknown key ${key}`).toBe(true)
    }
  })

  describe('linked parameters resolve LIVE at projection (the link is the authority)', () => {
    it('a property edit AFTER generation flows into the projected operation', () => {
      const design = buildReferenceApiDesign()
      // The fixture's GET /{{id}} links its id parameter to prop-user-id.
      // Edit the property AFTER the route was authored: the projection
      // must serve the property's current facts, not the frozen copy.
      const models = design.models.map((m) => m.id !== 'model-user' ? m : {
        ...m,
        properties: m.properties.map((p) => p.id !== 'prop-user-id' ? p : {
          ...p,
          doc: { ...p.doc, type: 'integer', format: 'int64', description: 'Renumbered identifier.' }
        })
      })
      const edited = { ...design, models }
      const projected = designToApiDocumentation(edited)
      const operation = projected.operations.find((op) => op.operationId === 'getUser')
      const idParam = operation?.parameters?.find((p) => p.name === 'id')
      expect(idParam?.type).toBe('integer')
      expect(idParam?.format).toBe('int64')
      // descriptionAuto is true in the fixture — the property's text wins.
      expect(idParam?.description).toBe('Renumbered identifier.')
    })

    it('a DETACHED description survives projection while type still resolves', () => {
      const design = buildReferenceApiDesign()
      const groups = design.routeGroups.map((g) => ({
        ...g,
        routes: g.routes.map((r) => {
          if (r.id !== 'route-user-get') return r
          const links = r.design?.paramLinks ?? {}
          const id = links['id']
          if (id === undefined) return r
          return {
            ...r,
            doc: {
              ...r.doc,
              parameters: (r.doc.parameters ?? []).map((p) => p.name === 'id' ? { ...p, description: 'My own words.' } : p)
            },
            design: { ...r.design, paramLinks: { ...links, id: { modelId: id.modelId, propertyId: id.propertyId } } }
          }
        })
      }))
      const projected = designToApiDocumentation({ ...design, routeGroups: groups })
      const operation = projected.operations.find((op) => op.operationId === 'getUser')
      const idParam = operation?.parameters?.find((p) => p.name === 'id')
      expect(idParam?.description).toBe('My own words.')
      expect(idParam?.type).toBe('string')
      expect(idParam?.format).toBe('uuid')
    })
  })
})
