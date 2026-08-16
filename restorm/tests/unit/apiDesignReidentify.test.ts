import { describe, it, expect } from 'vitest'
import { reidentifyForest } from '../../src/shared/utils/reidentifyTree'
import type { ApiDesign } from '../../src/shared/types/apiDesign'
import { buildReferenceApiDesign } from './apiDesignReference'

/**
 * Cloning / importing a design must leave the copy fully independent of
 * its source: every sub-entity id reminted, every internal ID reference
 * (typed property references, param links, identifier, inheritance,
 * served examples) following the copy, and the example value map —
 * keyed BY property id — rekeyed. A miss here is quiet until the copy
 * and the original coexist, then the duplicate-id dedup on the next
 * load remints one side and the stale references dangle.
 */
describe('reidentifyForest over an API design', () => {
  function collectDesignIds(design: ApiDesign): string[] {
    const ids = [design.id]
    for (const model of design.models) {
      ids.push(model.id, ...model.properties.map((p) => p.id), ...(model.examples ?? []).map((e) => e.id))
    }
    ids.push(...design.enums.map((e) => e.id))
    for (const group of design.routeGroups) {
      ids.push(group.id, ...group.routes.map((r) => r.id))
    }
    return ids
  }

  it('remints every design sub-entity id', () => {
    const design = buildReferenceApiDesign()
    const before = collectDesignIds(design)
    reidentifyForest([design])
    const after = collectDesignIds(design)

    expect(after).toHaveLength(before.length)
    expect(new Set(after).size).toBe(after.length)
    for (const oldId of before) expect(after).not.toContain(oldId)
  })

  it('every internal ID reference follows the copy', () => {
    const design = buildReferenceApiDesign()
    reidentifyForest([design])

    const user = design.models.find((m) => m.doc.name === 'User')
    const admin = design.models.find((m) => m.doc.name === 'AdminUser')
    const order = design.models.find((m) => m.doc.name === 'Order')
    const statusEnum = design.enums[0]
    const group = design.routeGroups[0]
    if (!user || !admin || !order || !statusEnum || !group) throw new Error('fixture entities present')

    // Inheritance follows the reminted parent.
    expect(admin.design?.inheritsFrom).toBe(user.id)
    // The identifier points at the reminted property.
    const userIdProp = user.properties.find((p) => p.doc.name === 'id')
    expect(user.design?.identifier?.propertyId).toBe(userIdProp?.id)
    // Typed references follow the reminted model / enum.
    const customer = order.properties.find((p) => p.doc.name === 'customer')
    expect(customer?.design?.reference?.refId).toBe(user.id)
    const status = user.properties.find((p) => p.doc.name === 'status')
    expect(status?.design?.reference?.refId).toBe(statusEnum.id)
    // Route param links + response models + served example follow.
    const getRoute = group.routes.find((r) => r.doc.match.method === 'GET' && r.doc.match.urlPattern.includes('{{id}}'))
    expect(getRoute?.design?.paramLinks?.['id']?.modelId).toBe(user.id)
    expect(getRoute?.design?.paramLinks?.['id']?.propertyId).toBe(userIdProp?.id)
    expect(getRoute?.design?.responses?.['200']?.modelId).toBe(user.id)
    expect(getRoute?.design?.responses?.['200']?.exampleId).toBe(user.examples?.[0]?.id)
    const postRoute = group.routes.find((r) => r.doc.match.method === 'POST')
    expect(postRoute?.design?.body?.modelId).toBe(user.id)
  })

  it('rekeys a named example value map onto the reminted property ids', () => {
    const design = buildReferenceApiDesign()
    reidentifyForest([design])

    const user = design.models.find((m) => m.doc.name === 'User')
    const example = user?.examples?.[0]
    if (!user || !example) throw new Error('fixture example present')
    const emailProp = user.properties.find((p) => p.doc.name === 'email')
    const statusProp = user.properties.find((p) => p.doc.name === 'status')

    expect(Object.keys(example.values).sort()).toEqual([emailProp?.id, statusProp?.id].sort())
    expect(example.values[emailProp?.id ?? '']).toBe('admin@example.com')
  })

  it('leaves the embedded documentation content untouched', () => {
    const design = buildReferenceApiDesign()
    const user = design.models.find((m) => m.doc.name === 'User')
    if (!user) throw new Error('fixture has User')
    // A doc example spelled exactly like a reference field must never be
    // rewritten — it is user content.
    const emailProp = user.properties.find((p) => p.doc.name === 'email')
    if (!emailProp) throw new Error('fixture has email')
    emailProp.doc.example = { modelId: user.id, refId: design.enums[0]?.id }
    const docBefore = JSON.stringify(emailProp.doc)

    reidentifyForest([design])

    const after = design.models.find((m) => m.doc.name === 'User')?.properties.find((p) => p.doc.name === 'email')
    expect(JSON.stringify(after?.doc)).toBe(docBefore)
  })
})
