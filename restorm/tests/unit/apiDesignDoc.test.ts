import { describe, it, expect } from 'vitest'
import {
  composeRoutePath,
  designModelDoc,
  designNameResolver,
  designToApiDocumentation,
  ensureLeadingSlash,
  groupChainBasePath,
  unionTags
} from '../../src/shared/design/apiDesignDoc'
import type { ApiDocumentation } from '../../src/shared/types/apiDocumentation'
import type { ApiDesign, DesignRouteGroup } from '../../src/shared/types/apiDesign'
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

describe('groupChainBasePath (nested route groups)', () => {
  const mkGroup = (id: string, basePath: string, opts: Partial<DesignRouteGroup> & { versionPrefix?: string } = {}): DesignRouteGroup => ({
    id,
    doc: { name: id },
    design: { basePath, ...(opts.versionPrefix !== undefined ? { versionPrefix: opts.versionPrefix } : {}) },
    routes: [],
    ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {})
  })
  const mkDesign = (routeGroups: DesignRouteGroup[]): ApiDesign =>
    ({ id: 'd', info: { title: 'D' }, models: [], enums: [], routeGroups }) as unknown as ApiDesign

  const root = mkGroup('root', '/houses', { versionPrefix: '/v1' })
  const child = mkGroup('child', '/rooms', { parentId: 'root' })
  const grandchild = mkGroup('grandchild', '/beds', { parentId: 'child' })
  const nested = mkDesign([root, child, grandchild])

  it('folds the ancestor chain (version + base per group) into one segment', () => {
    expect(groupChainBasePath(nested, root)).toBe('v1/houses')
    expect(groupChainBasePath(nested, child)).toBe('v1/houses/rooms')
    expect(groupChainBasePath(nested, grandchild)).toBe('v1/houses/rooms/beds')
  })

  it('composes a nested route to the full path', () => {
    expect(composeRoutePath({ designBasePath: '/api', groupBasePath: groupChainBasePath(nested, grandchild) }, '/{{id}}'))
      .toBe('/api/v1/houses/rooms/beds/{{id}}')
  })

  it('is cycle- and orphan-safe', () => {
    const a = mkGroup('a', '/a', { parentId: 'b' })
    const b = mkGroup('b', '/b', { parentId: 'a' })
    expect(() => groupChainBasePath(mkDesign([a, b]), a)).not.toThrow()
    const orphan = mkGroup('x', '/x', { parentId: 'gone' })
    expect(groupChainBasePath(mkDesign([orphan]), orphan)).toBe('x')
  })
})

describe('ensureLeadingSlash', () => {
  it('roots a slash-less base path', () => {
    expect(ensureLeadingSlash('api/v1')).toBe('/api/v1')
    expect(ensureLeadingSlash('v2')).toBe('/v2')
  })

  it('leaves an already-rooted path, a variable, a full URL and empty untouched', () => {
    expect(ensureLeadingSlash('/api/v1')).toBe('/api/v1')
    expect(ensureLeadingSlash('{{baseRoute}}')).toBe('{{baseRoute}}')
    expect(ensureLeadingSlash('https://api.example.com/v1')).toBe('https://api.example.com/v1')
    expect(ensureLeadingSlash('')).toBe('')
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
  })

  it('stacks operations in flattened route order (the edit-link contract)', () => {
    // ORDER CONTRACT: operations[i] ↔ the i-th id of
    // routeGroups[].routes[] flattened in declaration order — the
    // Documentation section's edit links map back through this index.
    const design = buildReferenceApiDesign()
    design.routeGroups.push({
      id: 'group-admin',
      doc: { name: 'Admin' },
      routes: [
        { id: 'route-admin-list', doc: { match: { urlPattern: '/admins', method: 'GET' } } },
        { id: 'route-admin-get', doc: { match: { urlPattern: '/admins/{{id}}', method: 'GET' } } }
      ]
    })
    const doc = designToApiDocumentation(design)
    const flattenedIds = design.routeGroups.flatMap((group) => group.routes.map((route) => route.id))
    expect(doc.operations).toHaveLength(flattenedIds.length)
    expect(flattenedIds).toEqual([
      'route-user-get', 'route-user-list', 'route-user-create',
      'route-admin-list', 'route-admin-get'
    ])
    // Identity check by method+pattern — two routes share /v1/users, so
    // the pattern alone would let a GET↔POST index swap pass.
    expect(doc.operations.map((op) => `${op.match.method ?? ''} ${op.match.urlPattern}`)).toEqual([
      'GET /v1/users/{{id}}', 'GET /v1/users', 'POST /v1/users',
      'GET /admins', 'GET /admins/{{id}}'
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

describe('tags — group + route union', () => {
  it('unionTags dedups, keeps group tags first and drops blanks', () => {
    expect(unionTags(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(unionTags(['x'], undefined)).toEqual(['x'])
    expect(unionTags(undefined, ['y'])).toEqual(['y'])
    expect(unionTags([' a ', ''], ['a', '  '])).toEqual(['a'])
    expect(unionTags(undefined, undefined)).toEqual([])
  })

  it('projects the union of group and route tags onto each operation', () => {
    const design = {
      id: 'd',
      info: { title: 'D' },
      models: [],
      enums: [],
      routeGroups: [{
        id: 'g',
        doc: { name: 'Pets', tags: ['pets', 'v1'] },
        routes: [
          { id: 'r1', doc: { match: { urlPattern: '/', method: 'GET' }, tags: ['pets', 'list'] } },
          { id: 'r2', doc: { match: { urlPattern: '/{{id}}', method: 'GET' } } }
        ]
      }]
    } as unknown as ApiDesign

    const doc = designToApiDocumentation(design)
    // r1: group ∪ route, deduped, group-first.
    expect(doc.operations[0]?.tags).toEqual(['pets', 'v1', 'list'])
    // r2: only the group's shared tags (no own tags).
    expect(doc.operations[1]?.tags).toEqual(['pets', 'v1'])
  })

  it('leaves an operation untagged when neither group nor route declares tags', () => {
    const design = {
      id: 'd', info: { title: 'D' }, models: [], enums: [],
      routeGroups: [{ id: 'g', doc: { name: 'Pets' }, routes: [{ id: 'r', doc: { match: { urlPattern: '/', method: 'GET' } } }] }]
    } as unknown as ApiDesign
    expect(designToApiDocumentation(design).operations[0]?.tags).toBeUndefined()
  })
})

describe('parameter enum reference', () => {
  it('projects a param’s named-enum reference to the enum name and drops inline values', () => {
    const design = {
      id: 'd',
      info: { title: 'T' },
      models: [],
      enums: [{ id: 'e1', doc: { name: 'PetStatus', properties: [], enumValues: ['available', 'sold'] } }],
      routeGroups: [{
        id: 'g',
        doc: { name: 'Pets' },
        routes: [{
          id: 'r',
          doc: { match: { urlPattern: '/', method: 'GET' }, parameters: [{ name: 'status', location: 'query', type: 'string', required: false, enumValues: ['stale'] }] },
          design: { paramEnumRefs: { status: 'e1' } }
        }]
      }]
    } as unknown as ApiDesign
    const status = designToApiDocumentation(design).operations[0]?.parameters?.find((p) => p.name === 'status')
    // The type becomes the enum name (→ a $ref on export) and the inline values
    // give way to the shared component.
    expect(status?.type).toBe('PetStatus')
    expect(status?.enumValues).toBeUndefined()
  })
})
