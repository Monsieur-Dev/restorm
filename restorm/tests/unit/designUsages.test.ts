import { describe, it, expect } from 'vitest'
import {
  collectModelUsages,
  collectInheritanceChildren,
  removeModelFromDesign
} from '../../src/shared/design/designUsages'
import { buildReferenceApiDesign } from './apiDesignReference'

// One walk feeds BOTH the "Used by" jump list and the delete-impact
// modal — these tests pin that the walk sees every reference kind, and
// that removal strips exactly what the modal announced.
describe('designUsages', () => {
  it('collects every usage kind for the reference model', () => {
    const design = buildReferenceApiDesign()
    const usages = collectModelUsages(design, 'model-user')
    const kinds = usages.map((u) => `${u.kind}:${u.entityId}${u.detail !== undefined ? `:${u.detail}` : ''}`)

    expect(kinds).toContain('routeParam:route-user-get:id')
    expect(kinds).toContain('routeResponse:route-user-get:200')
    expect(kinds).toContain('routeResponse:route-user-list:200')
    expect(kinds).toContain('routeBody:route-user-create')
    expect(kinds).toContain('routeResponse:route-user-create:201')
    expect(kinds).toContain('modelInheritance:model-admin')
    // Order.customer AND Order.lines both reference User.
    expect(usages.filter((u) => u.kind === 'modelProperty' && u.entityId === 'model-order')).toHaveLength(2)
  })

  it('lists direct inheritance children', () => {
    const design = buildReferenceApiDesign()
    expect(collectInheritanceChildren(design, 'model-user').map((m) => m.id)).toEqual(['model-admin'])
    expect(collectInheritanceChildren(design, 'model-order')).toEqual([])
  })

  it('removeModelFromDesign strips the model and every reference to it', () => {
    const design = buildReferenceApiDesign()
    const { models, routeGroups } = removeModelFromDesign(design, 'model-user')

    expect(models.map((m) => m.id)).toEqual(['model-admin', 'model-order'])

    // The child kept its own properties but lost the inheritance link.
    const admin = models.find((m) => m.id === 'model-admin')
    expect(admin?.design?.inheritsFrom).toBeUndefined()
    expect(admin?.properties.map((p) => p.doc.name)).toEqual(['scope'])

    // Referencing properties degrade to their doc type, reference cleared.
    const order = models.find((m) => m.id === 'model-order')
    const customer = order?.properties.find((p) => p.id === 'prop-order-customer')
    expect(customer?.design?.reference).toBeUndefined()
    expect(customer?.doc.targetModelRef).toBeUndefined()
    const lines = order?.properties.find((p) => p.id === 'prop-order-items')
    expect(lines?.design?.reference).toBeUndefined()
    expect(lines?.doc.isArrayOfRef).toBeUndefined()

    // Routes: body model dropped, response models stripped, param links removed.
    const routes = routeGroups.flatMap((g) => g.routes)
    const get = routes.find((r) => r.id === 'route-user-get')
    expect(get?.design?.paramLinks).toEqual({})
    expect(get?.design?.responses?.['200']?.modelId).toBeUndefined()
    expect(get?.design?.responses?.['200']?.exampleId).toBeUndefined()
    const create = routes.find((r) => r.id === 'route-user-create')
    expect(create?.design?.body?.modelId).toBeUndefined()
    expect(create?.design?.body?.contentType).toBe('application/json')
    expect(create?.design?.responses?.['201']?.modelId).toBeUndefined()
    // Non-model facts survive untouched.
    const list = routes.find((r) => r.id === 'route-user-list')
    expect(list?.design?.pagination?.defaultLimit).toBe(20)
    expect(list?.design?.responses?.['200']?.list).toBe(true)
  })

  it('removing an unused model leaves everything else byte-identical', () => {
    const design = buildReferenceApiDesign()
    const { models, routeGroups } = removeModelFromDesign(design, 'model-order')
    expect(models.map((m) => m.id)).toEqual(['model-user', 'model-admin'])
    expect(models.find((m) => m.id === 'model-user')).toEqual(design.models.find((m) => m.id === 'model-user'))
    expect(routeGroups).toEqual(design.routeGroups)
  })
})
