/**
 * "Extract to a named enum" — the find-or-create helper shared by the model
 * property and route parameter extract actions. The dedup (reuse an existing
 * enum with identical values, else mint a fresh uniquely-named one) had no
 * coverage; a loose/order-insensitive match would mint duplicates or reuse the
 * wrong enum.
 */

import { describe, it, expect } from 'vitest'
import { findOrCreateEnumForValues } from '../../src/renderer/src/components/Design/designMutations'
import type { ApiDesign } from '../../src/shared/types/collections'

function design(enums: ApiDesign['enums'] = []): ApiDesign {
  return { type: 'design', id: 'd', name: 'D', info: { title: 'D', version: '1.0.0' }, models: [], enums, routeGroups: [] }
}

describe('findOrCreateEnumForValues', () => {
  it('reuses an existing enum with the same values (dedup — no duplicate minted)', () => {
    const d = design([{ id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['open', 'closed'] } }])
    const result = findOrCreateEnumForValues(d, ['open', 'closed'], 'FooBar', () => 'enum-new')
    expect(result).toEqual({ refId: 'e1', created: false })
    expect(d.enums).toHaveLength(1)
  })

  it('mints a new enum when no existing values match', () => {
    const d = design([{ id: 'e1', doc: { name: 'Status', properties: [], enumValues: ['open', 'closed'] } }])
    const result = findOrCreateEnumForValues(d, ['a', 'b'], 'FooBar', () => 'enum-new')
    expect(result.created).toBe(true)
    expect(result.refId).toBe('enum-new')
    expect(d.enums).toHaveLength(2)
    expect(d.enums[1]?.doc.enumValues).toEqual(['a', 'b'])
  })

  it('is order-sensitive: a different order mints a new enum (not a false dedup)', () => {
    const d = design([{ id: 'e1', doc: { name: 'S', properties: [], enumValues: ['a', 'b'] } }])
    const result = findOrCreateEnumForValues(d, ['b', 'a'], 'X', () => 'enum-new')
    expect(result.created).toBe(true)
  })

  it('gives the minted enum a name that does not collide with an existing component', () => {
    const d = design([{ id: 'e1', doc: { name: 'FooBar', properties: [], enumValues: ['x'] } }])
    const result = findOrCreateEnumForValues(d, ['a', 'b'], 'FooBar', () => 'enum-new')
    expect(result.created).toBe(true)
    expect(d.enums[1]?.doc.name).not.toBe('FooBar')
  })

  it('compares by string value, so numbers and their string form dedup together', () => {
    const d = design([{ id: 'e1', doc: { name: 'Codes', properties: [], enumValues: [1, 2] } }])
    const result = findOrCreateEnumForValues(d, ['1', '2'], 'X', () => 'enum-new')
    expect(result).toEqual({ refId: 'e1', created: false })
  })
})
