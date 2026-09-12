import { describe, it, expect } from 'vitest'
import { validateApiDesign, isDesignValid } from '../../src/shared/design/validateApiDesign'
import type { ApiDesign, DesignModel } from '../../src/shared/types/apiDesign'
import { buildReferenceApiDesign } from './apiDesignReference'

const codes = (design: ApiDesign): string[] => validateApiDesign(design).map((i) => i.code)

function withModels(...models: DesignModel[]): ApiDesign {
  return {
    type: 'design',
    id: 'd',
    name: 'D',
    tags: [],
    info: { title: 'D' },
    models,
    enums: [],
    routeGroups: []
  }
}

const model = (id: string, name: string, extra?: Partial<DesignModel>): DesignModel => ({
  id,
  doc: { name },
  properties: [],
  ...extra
})

describe('validateApiDesign', () => {
  it('the reference design is valid', () => {
    expect(validateApiDesign(buildReferenceApiDesign())).toEqual([])
    expect(isDesignValid(buildReferenceApiDesign())).toBe(true)
  })

  it('reports an empty property name with the row path', () => {
    const design = withModels({
      ...model('m1', 'User'),
      properties: [{ id: 'p1', doc: { name: '', type: 'string', required: false } }]
    })
    const issues = validateApiDesign(design)
    expect(issues).toEqual([{ code: 'propertyNameEmpty', path: ['d', 'm1', 'p1'] }])
  })

  it('reports duplicate sibling property names on the second row', () => {
    const design = withModels({
      ...model('m1', 'User'),
      properties: [
        { id: 'p1', doc: { name: 'email', type: 'string', required: false } },
        { id: 'p2', doc: { name: 'email', type: 'string', required: false } }
      ]
    })
    expect(validateApiDesign(design)).toEqual([
      { code: 'propertyNameDuplicate', path: ['d', 'm1', 'p2'], subject: 'email' }
    ])
  })

  it('reports a property shadowing an inherited one', () => {
    const parent = {
      ...model('m1', 'User'),
      properties: [{ id: 'p1', doc: { name: 'email', type: 'string', required: false } }]
    }
    const child = {
      ...model('m2', 'AdminUser', { design: { inheritsFrom: 'm1' } }),
      properties: [{ id: 'p2', doc: { name: 'email', type: 'string', required: false } }]
    }
    expect(validateApiDesign(withModels(parent, child))).toEqual([
      { code: 'propertyShadowsParent', path: ['d', 'm2', 'p2'], subject: 'email' }
    ])
  })

  it('shadowing is visible through a whole inheritance chain', () => {
    const grandParent = {
      ...model('m1', 'Base'),
      properties: [{ id: 'p1', doc: { name: 'id', type: 'string', required: false } }]
    }
    const parent = model('m2', 'Middle', { design: { inheritsFrom: 'm1' } })
    const child = {
      ...model('m3', 'Leaf', { design: { inheritsFrom: 'm2' } }),
      properties: [{ id: 'p3', doc: { name: 'id', type: 'string', required: false } }]
    }
    expect(codes(withModels(grandParent, parent, child))).toEqual(['propertyShadowsParent'])
  })

  it('flags EVERY member of a duplicate model / enum name group, each listing the others', () => {
    const design = withModels(model('m1', 'User'), model('m2', 'User'))
    design.enums = [
      { id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['a'] } },
      { id: 'e2', doc: { name: 'Status', properties: [], enumValues: ['b'] } }
    ]
    expect(validateApiDesign(design)).toEqual([
      { code: 'modelNameDuplicate', path: ['d', 'm1'], subject: 'User', collisionWith: ['m2'] },
      { code: 'modelNameDuplicate', path: ['d', 'm2'], subject: 'User', collisionWith: ['m1'] },
      { code: 'enumNameDuplicate', path: ['d', 'e1'], subject: 'Status', collisionWith: ['e2'] },
      { code: 'enumNameDuplicate', path: ['d', 'e2'], subject: 'Status', collisionWith: ['e1'] }
    ])
  })

  it('flags BOTH a model and an enum sharing a name — one component namespace', () => {
    const design = withModels(model('m1', 'Status'))
    design.enums = [{ id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['a'] } }]
    expect(validateApiDesign(design)).toEqual([
      { code: 'componentNameCollision', path: ['d', 'm1'], subject: 'Status', collisionWith: ['e1'] },
      { code: 'componentNameCollision', path: ['d', 'e1'], subject: 'Status', collisionWith: ['m1'] }
    ])
  })

  it('reports empty model, enum and group names', () => {
    const design = withModels(model('m1', ''))
    design.enums = [{ id: 'e1', doc: { name: '', properties: [], enumValues: [] } }]
    design.routeGroups = [{ id: 'g1', doc: { name: '' }, routes: [] }]
    expect(codes(design).sort()).toEqual(['enumNameEmpty', 'groupNameEmpty', 'modelNameEmpty'])
  })

  it('flags BOTH duplicate route groups, each listing the other', () => {
    const design = withModels()
    design.routeGroups = [
      { id: 'g1', doc: { name: 'Users' }, routes: [] },
      { id: 'g2', doc: { name: 'Users' }, routes: [] }
    ]
    expect(validateApiDesign(design)).toEqual([
      { code: 'groupNameDuplicate', path: ['d', 'g1'], subject: 'Users', collisionWith: ['g2'] },
      { code: 'groupNameDuplicate', path: ['d', 'g2'], subject: 'Users', collisionWith: ['g1'] }
    ])
  })

  it('reports an unknown inheritance target', () => {
    const design = withModels(model('m1', 'User', { design: { inheritsFrom: 'missing' } }))
    expect(codes(design)).toEqual(['inheritanceTargetUnknown'])
  })

  it('reports inheritance cycles on every member', () => {
    const a = model('m1', 'A', { design: { inheritsFrom: 'm2' } })
    const b = model('m2', 'B', { design: { inheritsFrom: 'm1' } })
    expect(codes(withModels(a, b))).toEqual(['inheritanceCycle', 'inheritanceCycle'])
  })

  it('a self-inheriting model is a cycle', () => {
    expect(codes(withModels(model('m1', 'A', { design: { inheritsFrom: 'm1' } })))).toEqual(['inheritanceCycle'])
  })

  it('reports a dangling property reference', () => {
    const design = withModels({
      ...model('m1', 'User'),
      properties: [{
        id: 'p1',
        doc: { name: 'status', type: 'string', required: false },
        design: { reference: { target: 'enum', refId: 'missing' } }
      }]
    })
    expect(validateApiDesign(design)).toEqual([
      { code: 'referenceTargetUnknown', path: ['d', 'm1', 'p1'], subject: 'missing' }
    ])
  })

  it('reports an identifier pointing at no property', () => {
    const design = withModels(model('m1', 'User', {
      design: { identifier: { propertyId: 'missing', strategy: 'uuid' } }
    }))
    expect(codes(design)).toEqual(['identifierPropertyUnknown'])
  })

  it('reports dangling route links (param, body, response model, response example)', () => {
    const design = withModels(model('m1', 'User'))
    design.routeGroups = [{
      id: 'g1',
      doc: { name: 'Users' },
      routes: [{
        id: 'r1',
        doc: {
          match: { urlPattern: '/{{id}}', method: 'GET' },
          // Declared so `routeResponsesMissing` stays out of this test.
          responses: { '200': {}, '201': {} }
        },
        design: {
          paramLinks: { id: { modelId: 'm1', propertyId: 'missing' } },
          body: { modelId: 'missing' },
          responses: {
            '200': { modelId: 'missing' },
            '201': { modelId: 'm1', exampleId: 'missing' }
          }
        }
      }]
    }]
    expect(codes(design).sort()).toEqual([
      'bodyModelUnknown',
      'paramLinkTargetUnknown',
      'responseExampleUnknown',
      'responseModelUnknown'
    ])
  })

  it('reports a route declaring no response at all', () => {
    const design = withModels(model('m1', 'User'))
    design.routeGroups = [{
      id: 'g1',
      doc: { name: 'Users' },
      routes: [{ id: 'r1', doc: { match: { urlPattern: '/', method: 'GET' } } }]
    }]
    expect(codes(design)).toEqual(['routeResponsesMissing'])
  })

  it('reports two routes resolving to the same method + composed path', () => {
    const design = withModels(model('m1', 'User'))
    design.routeGroups = [
      {
        id: 'g1',
        doc: { name: 'Users' },
        design: { basePath: '/users' },
        routes: [{ id: 'r1', doc: { match: { urlPattern: '/', method: 'GET' }, responses: { '200': {} } } }]
      },
      {
        id: 'g2',
        doc: { name: 'PowerUsers' },
        design: { basePath: '/users' },
        routes: [
          // Same surface as g1's list route — BOTH claimants are flagged.
          { id: 'r2', doc: { match: { urlPattern: '/', method: 'GET' }, responses: { '200': {} } } },
          // Same path, different METHOD — legal.
          { id: 'r3', doc: { match: { urlPattern: '/', method: 'POST' }, responses: { '201': {} } } }
        ]
      }
    ]
    expect(validateApiDesign(design)).toEqual([
      { code: 'routePathDuplicate', path: ['d', 'g1', 'r1'], subject: 'GET /users', collisionWith: ['r2'] },
      { code: 'routePathDuplicate', path: ['d', 'g2', 'r2'], subject: 'GET /users', collisionWith: ['r1'] }
    ])
  })

  it('sees through parameter names — {{id}} and {{userId}} are one surface', () => {
    const design = withModels(model('m1', 'User'))
    design.routeGroups = [{
      id: 'g1',
      doc: { name: 'Users' },
      design: { basePath: '/users' },
      routes: [
        { id: 'r1', doc: { match: { urlPattern: '/{{id}}', method: 'GET' }, responses: { '200': {} } } },
        { id: 'r2', doc: { match: { urlPattern: '/{{userId}}', method: 'GET' }, responses: { '200': {} } } }
      ]
    }]
    expect(validateApiDesign(design)).toEqual([
      { code: 'routePathDuplicate', path: ['d', 'g1', 'r1'], subject: 'GET /users/{*}', collisionWith: ['r2'] },
      { code: 'routePathDuplicate', path: ['d', 'g1', 'r2'], subject: 'GET /users/{*}', collisionWith: ['r1'] }
    ])
  })

  it('flags a route composing onto an enabled projection endpoint', () => {
    const design = withModels(model('m1', 'User'))
    design.serving = { protocols: ['graphql'] }
    design.routeGroups = [{
      id: 'g1',
      doc: { name: 'Misc' },
      routes: [
        { id: 'r1', doc: { match: { urlPattern: '/graphql', method: 'POST' }, responses: { '200': {} } } }
      ]
    }]
    expect(validateApiDesign(design)).toEqual([
      { code: 'routePathReserved', path: ['d', 'g1', 'r1'], subject: '/graphql' }
    ])
    // The same route is fine while the projection stays off.
    design.serving = {}
    expect(validateApiDesign(design)).toEqual([])
  })

  it('always reserves /swagger.json, base path included', () => {
    const design = withModels(model('m1', 'User'))
    design.server = { basePath: '/swagger.json' }
    design.routeGroups = [{
      id: 'g1',
      doc: { name: 'Misc' },
      routes: [
        { id: 'r1', doc: { match: { urlPattern: '/', method: 'GET' }, responses: { '200': {} } } }
      ]
    }]
    expect(validateApiDesign(design)).toEqual([
      { code: 'routePathReserved', path: ['d', 'g1', 'r1'], subject: '/swagger.json' }
    ])
  })

  it('reserves the descriptor UNDER the base path too', () => {
    const design = withModels(model('m1', 'User'))
    design.server = { basePath: '/api/v1' }
    design.routeGroups = [{
      id: 'g1',
      doc: { name: 'Misc' },
      routes: [
        { id: 'r1', doc: { match: { urlPattern: '/swagger.json', method: 'GET' }, responses: { '200': {} } } }
      ]
    }]
    expect(validateApiDesign(design)).toEqual([
      { code: 'routePathReserved', path: ['d', 'g1', 'r1'], subject: '/api/v1/swagger.json' }
    ])
  })
})
