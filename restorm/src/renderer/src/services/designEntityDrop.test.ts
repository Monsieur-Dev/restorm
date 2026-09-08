import { describe, it, expect } from 'vitest'
import type { ApiDesign, DesignModel } from '../../../shared/types/collections'
import { canDropDesignEntity, applyDesignEntityDrop } from './designEntityDrop'

const model = (id: string, inheritsFrom?: string): DesignModel => ({
  id,
  doc: { name: id },
  properties: [],
  ...(inheritsFrom !== undefined ? { design: { inheritsFrom } } : {})
})

const design = (over: Partial<ApiDesign>): ApiDesign => ({
  id: 'd',
  doc: { name: 'D' },
  models: [],
  enums: [],
  routeGroups: [],
  ...over
} as ApiDesign)

describe('designEntityDrop — models', () => {
  it('reparents a model onto another (into) via inheritsFrom', () => {
    const d = design({ models: [model('a'), model('b'), model('c')] })
    applyDesignEntityDrop(d, 'models', 'c', 'a', 'into')
    expect(d.models.find((m) => m.id === 'c')?.design?.inheritsFrom).toBe('a')
  })

  it('reorder before a sibling adopts the sibling parent (root here → no inheritance)', () => {
    const d = design({ models: [model('a'), model('b'), model('c')] })
    applyDesignEntityDrop(d, 'models', 'c', 'a', 'before')
    expect(d.models.map((m) => m.id)).toEqual(['c', 'a', 'b'])
    expect(d.models.find((m) => m.id === 'c')?.design?.inheritsFrom).toBeUndefined()
  })

  it('refuses a drop that would create an inheritance cycle', () => {
    // b inherits a; dropping a INTO b would make a inherit b → cycle.
    const d = design({ models: [model('a'), model('b', 'a')] })
    expect(canDropDesignEntity(d, 'models', 'a', 'b', 'into')).toBe(false)
    applyDesignEntityDrop(d, 'models', 'a', 'b', 'into')
    expect(d.models.find((m) => m.id === 'a')?.design?.inheritsFrom).toBeUndefined()
  })

  it('never drops onto itself', () => {
    const d = design({ models: [model('a')] })
    expect(canDropDesignEntity(d, 'models', 'a', 'a', 'into')).toBe(false)
  })
})

describe('designEntityDrop — enums', () => {
  const enumOf = (id: string): ApiDesign['enums'][number] =>
    ({ id, doc: { name: id, properties: [], enumValues: [] } } as ApiDesign['enums'][number])

  it('reorders enums (flat)', () => {
    const d = design({ enums: [enumOf('x'), enumOf('y'), enumOf('z')] })
    applyDesignEntityDrop(d, 'enums', 'z', 'x', 'before')
    expect(d.enums.map((e) => e.id)).toEqual(['z', 'x', 'y'])
  })

  it('any enum reorder is allowed (except onto itself)', () => {
    const d = design({ enums: [enumOf('x'), enumOf('y')] })
    expect(canDropDesignEntity(d, 'enums', 'x', 'y', 'after')).toBe(true)
    expect(canDropDesignEntity(d, 'enums', 'x', 'x', 'after')).toBe(false)
  })
})

describe('designEntityDrop — routes', () => {
  const group = (id: string, parentId?: string): ApiDesign['routeGroups'][number] =>
    ({ id, doc: { name: id }, routes: [], ...(parentId !== undefined ? { parentId } : {}) } as ApiDesign['routeGroups'][number])

  it('reorders route groups', () => {
    const d = design({ routeGroups: [group('g1'), group('g2')] })
    applyDesignEntityDrop(d, 'routes', 'g2', 'g1', 'before')
    expect(d.routeGroups.map((g) => g.id)).toEqual(['g2', 'g1'])
  })

  it('refuses dropping a group into its own descendant', () => {
    const d = design({ routeGroups: [group('g1'), group('g2', 'g1')] })
    expect(canDropDesignEntity(d, 'routes', 'g1', 'g2', 'into')).toBe(false)
  })
})
