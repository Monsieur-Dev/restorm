import { describe, it, expect } from 'vitest'
import { buildModelGraphElements } from '../../src/renderer/src/components/documentation/modelGraphLayout'
import type { ModelDocumentation } from '../../src/shared/types/apiDocumentation'

const PetGraph: ModelDocumentation[] = [
  {
    name: 'Pet',
    properties: [
      { name: 'id', type: 'integer', required: true },
      { name: 'category', type: 'Category', required: false, targetModelRef: 'Category' },
      { name: 'tags', type: 'array<Tag>', required: false, targetModelRef: 'Tag', isArrayOfRef: true },
      { name: 'rogue', type: 'Ghost', required: false, targetModelRef: 'Ghost' }  // dangling — Ghost isn't in the graph
    ]
  },
  {
    name: 'Category',
    properties: [{ name: 'id', type: 'integer', required: false }]
  },
  {
    name: 'Tag',
    properties: [{ name: 'id', type: 'integer', required: false }]
  }
]

describe('buildModelGraphElements', () => {
  it('produces one React Flow node per model', async () => {
    const { nodes } = await buildModelGraphElements(PetGraph)
    expect(nodes.map((n) => n.id).sort()).toEqual(['Category', 'Pet', 'Tag'])
  })

  it('skips edges whose target isn\'t in the rendered set (dangling refs)', async () => {
    const { edges } = await buildModelGraphElements(PetGraph)
    const ids = edges.map((e) => e.id)
    expect(ids).toContain('Pet::category->Category')
    expect(ids).toContain('Pet::tags->Tag')
    // Ghost is not in the graph, so the rogue edge must not appear.
    expect(ids.find((id) => id.includes('Ghost'))).toBeUndefined()
  })

  it('encodes the property cardinality + requiredness on each edge data', async () => {
    const { edges } = await buildModelGraphElements(PetGraph)
    const cat = edges.find((e) => e.id === 'Pet::category->Category')
    const tags = edges.find((e) => e.id === 'Pet::tags->Tag')
    interface EdgeRel { relation: 'single' | 'array'; required: boolean }
    expect((cat?.data as EdgeRel | undefined)).toEqual({
      relation: 'single',
      required: false,
      bendPoints: expect.any(Array) as unknown
    })
    expect((tags?.data as EdgeRel | undefined)?.relation).toBe('array')
  })

  it('emits stable, deterministic edge ids across runs', async () => {
    const a = await buildModelGraphElements(PetGraph)
    const b = await buildModelGraphElements(PetGraph)
    const aIds = a.edges.map((e) => e.id).sort()
    const bIds = b.edges.map((e) => e.id).sort()
    expect(aIds).toEqual(bIds)
  })

  it('returns no edges when models reference no other models', async () => {
    const { edges } = await buildModelGraphElements([
      { name: 'Plain', properties: [{ name: 'id', type: 'integer', required: true }] }
    ])
    expect(edges).toEqual([])
  })
})
