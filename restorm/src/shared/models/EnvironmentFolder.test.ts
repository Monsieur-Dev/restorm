import { describe, it, expect } from 'vitest'
import { EnvironmentFolder } from './EnvironmentFolder'

/**
 * Every optional document field on the class must round-trip through
 * `fromPlain` → `toPlainObject`. The renderer→main `collections:sync`
 * mirror reifies roots through `fromPlain`, and a main-driven save (any
 * MCP write) persists what the class carries — a field missing from
 * either side is silently DELETED from the project file on the next
 * MCP write, which is exactly how `enumDefinitions` got lost.
 */
describe('EnvironmentFolder fromPlain/toPlainObject round-trip', () => {
  const plain = {
    id: 'f1',
    name: 'Root',
    notes: 'hello',
    tags: ['a'],
    tagColors: { a: '#ff0000' },
    configuration: {},
    environments: [],
    items: [],
    importSource: 'swagger' as const,
    customValueLists: [
      { id: 'l1', name: 'PetIds', entries: [{ id: 'e1', label: 'Pet 1', value: '1' }] }
    ],
    enumDefinitions: [{ id: 'petid-enum', name: 'PetIdEnum', values: ['1', '2', '3'] }]
  }

  it('preserves enumDefinitions through fromPlain', () => {
    const folder = EnvironmentFolder.fromPlain(plain)
    expect(folder.enumDefinitions).toEqual(plain.enumDefinitions)
  })

  it('preserves enumDefinitions through toPlainObject', () => {
    const folder = EnvironmentFolder.fromPlain(plain)
    const out = folder.toPlainObject()
    expect(out['enumDefinitions']).toEqual(plain.enumDefinitions)
    expect(out['customValueLists']).toEqual(plain.customValueLists)
    expect(out['notes']).toBe('hello')
  })

  it('leaves enumDefinitions absent when the source has none', () => {
    const folder = EnvironmentFolder.fromPlain({ id: 'f2', name: 'Empty' })
    expect(folder.enumDefinitions).toBeUndefined()
    expect('enumDefinitions' in folder.toPlainObject()).toBe(false)
  })
})
