import { describe, it, expect } from 'vitest'
import { collectAllEnvValueTypes } from './collectAllEnvValueTypes'
import type { EnvironmentFolder, Folder } from '../../../shared/types/folderTypes'
import type { EnumDefinition, CustomValueList } from '../../../shared/types/collections'

const enumDef = (id: string, name: string): EnumDefinition => ({
  id,
  name,
  values: ['a', 'b'],
  matchingRules: []
})

const customList = (id: string, name: string): CustomValueList => ({
  id,
  name,
  entries: [{ id: `${id}-e1`, label: 'x', value: 'X', enabled: true }]
})

const envFolder = (
  id: string,
  enums: EnumDefinition[],
  lists: CustomValueList[],
  items: EnvironmentFolder['items'] = []
): EnvironmentFolder => ({
  id,
  name: id,
  folderType: 'environment',
  fileFormatVersion: 1,
  environments: [],
  tags: [],
  configuration: {} as EnvironmentFolder['configuration'],
  enumDefinitions: enums,
  customValueLists: lists,
  items
})

const plainFolder = (id: string, items: Folder['items']): Folder => ({
  id,
  name: id,
  tags: [],
  configuration: {} as Folder['configuration'],
  items
})

describe('collectAllEnvValueTypes', () => {
  it('collects enums + custom lists from a nested env-folder tree', () => {
    const nested = envFolder('child-env', [enumDef('e2', 'Beta')], [customList('l2', 'L2')])
    const wrapper = plainFolder('plain', [nested])
    const root = envFolder('root-env', [enumDef('e1', 'Alpha')], [customList('l1', 'L1')], [wrapper])

    const result = collectAllEnvValueTypes([root])

    expect(result.enumDefinitions.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
    expect(result.customValueLists.map((l) => l.id).sort()).toEqual(['l1', 'l2'])
  })

  it('de-dupes enums + custom lists by id across folders', () => {
    const a = envFolder('env-a', [enumDef('dup', 'Dup A')], [customList('dupL', 'Dup L A')])
    const b = envFolder('env-b', [enumDef('dup', 'Dup B')], [customList('dupL', 'Dup L B')])

    const result = collectAllEnvValueTypes([a, b])

    expect(result.enumDefinitions).toHaveLength(1)
    expect(result.enumDefinitions[0]?.name).toBe('Dup A')
    expect(result.customValueLists).toHaveLength(1)
    expect(result.customValueLists[0]?.name).toBe('Dup L A')
  })

  it('returns empty arrays when no env folder defines types', () => {
    const result = collectAllEnvValueTypes([plainFolder('p', []) as unknown as EnvironmentFolder])
    expect(result.enumDefinitions).toEqual([])
    expect(result.customValueLists).toEqual([])
  })
})
