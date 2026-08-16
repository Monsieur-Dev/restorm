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

  it('reports duplicate model and enum names', () => {
    const design = withModels(model('m1', 'User'), model('m2', 'User'))
    design.enums = [
      { id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['a'] } },
      { id: 'e2', doc: { name: 'Status', properties: [], enumValues: ['b'] } }
    ]
    expect(codes(design).sort()).toEqual(['enumNameDuplicate', 'modelNameDuplicate'])
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
        doc: { match: { urlPattern: '/{{id}}', method: 'GET' } },
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
})
