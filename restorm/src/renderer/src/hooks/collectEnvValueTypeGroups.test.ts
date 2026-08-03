import { describe, it, expect } from 'vitest'
import { collectEnvValueTypeGroups } from './collectEnvValueTypeGroups'
import type { EnvironmentFolder, Folder } from '../../../shared/types/folderTypes'
import type { EnumDefinition, CustomValueList } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'

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

const apiDoc = (modelName: string): ApiDocumentation =>
  ({
    models: {
      [modelName]: { name: modelName, enumValues: ['ACTIVE', 'BANNED'], properties: [] }
    }
  }) as unknown as ApiDocumentation

const envFolder = (
  id: string,
  enums: EnumDefinition[],
  lists: CustomValueList[],
  items: EnvironmentFolder['items'] = [],
  doc?: ApiDocumentation
): EnvironmentFolder => ({
  id,
  name: id,
  folderType: 'environment',
  environments: [],
  tags: [],
  configuration: {} as EnvironmentFolder['configuration'],
  enumDefinitions: enums,
  customValueLists: lists,
  items,
  ...(doc ? { apiDocumentation: doc } : {})
})

const plainFolder = (id: string, items: Folder['items']): Folder => ({
  id,
  name: id,
  tags: [],
  configuration: {} as Folder['configuration'],
  items
})

describe('collectEnvValueTypeGroups', () => {
  it('produces one group per env folder in a nested tree', () => {
    const nested = envFolder('child-env', [enumDef('e2', 'Beta')], [customList('l2', 'L2')])
    const wrapper = plainFolder('plain', [nested])
    const root = envFolder('root-env', [enumDef('e1', 'Alpha')], [customList('l1', 'L1')], [wrapper])

    const groups = collectEnvValueTypeGroups([root])

    expect(groups.map((g) => g.id)).toEqual(['root-env', 'child-env'])
    const rootGroup = groups.find((g) => g.id === 'root-env')
    const childGroup = groups.find((g) => g.id === 'child-env')
    expect(rootGroup?.enumDefinitions.map((e) => e.id)).toEqual(['e1'])
    expect(rootGroup?.customValueLists.map((l) => l.id)).toEqual(['l1'])
    expect(childGroup?.enumDefinitions.map((e) => e.id)).toEqual(['e2'])
    expect(childGroup?.customValueLists.map((l) => l.id)).toEqual(['l2'])
  })

  it('includes apiDoc enum models with folder-prefixed ids', () => {
    const root = envFolder('env-a', [enumDef('own', 'Own')], [], [], apiDoc('AccountStatus'))

    const groups = collectEnvValueTypeGroups([root])
    const group = groups[0]

    expect(group?.enumDefinitions.map((e) => e.id)).toEqual(['own', 'env-a::AccountStatus'])
    const apiEnum = group?.enumDefinitions.find((e) => e.id === 'env-a::AccountStatus')
    expect(apiEnum?.name).toBe('AccountStatus')
    expect(apiEnum?.values).toEqual(['ACTIVE', 'BANNED'])
  })

  it('namespaces same-named apiDoc models per folder so they do not collide', () => {
    const a = envFolder('env-a', [], [], [], apiDoc('Status'))
    const b = envFolder('env-b', [], [], [], apiDoc('Status'))

    const groups = collectEnvValueTypeGroups([a, b])

    expect(groups.map((g) => g.enumDefinitions[0]?.id)).toEqual(['env-a::Status', 'env-b::Status'])
  })

  it('defaults missing custom lists / enums to empty arrays', () => {
    const base = envFolder('env-empty', [], [])
    delete (base as { enumDefinitions?: unknown }).enumDefinitions
    delete (base as { customValueLists?: unknown }).customValueLists
    const groups = collectEnvValueTypeGroups([base])
    expect(groups[0]?.enumDefinitions).toEqual([])
    expect(groups[0]?.customValueLists).toEqual([])
  })

  it('returns no groups when there are no env folders', () => {
    const groups = collectEnvValueTypeGroups([plainFolder('p', []) as unknown as EnvironmentFolder])
    expect(groups).toEqual([])
  })
})
