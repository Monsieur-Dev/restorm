import { describe, it, expect } from 'vitest'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import { collectAllEnvironments } from './collectAllEnvironments'

/** Minimal env-folder fixture — only the fields the collector reads. */
function envFolder(name: string, environments: unknown[], items: unknown[] = []): EnvironmentFolder {
  return { folderType: 'environment', name, environments, items } as unknown as EnvironmentFolder
}

describe('collectAllEnvironments', () => {
  it('gathers environments from every folder, tagging each with its folder name', () => {
    const collections = [
      envFolder('Petstore', [
        { id: 'a', name: 'localhost', subEnvironments: [{ id: 'b', name: 'https' }] }
      ]),
      envFolder('Artifacts', [{ id: 'c', name: 'prod' }])
    ] as unknown as EnvironmentFolder[]

    const rows = collectAllEnvironments(collections)

    expect(rows.map((r) => [r.env.id, r.depth, r.groupLabel])).toEqual([
      ['a', 0, 'Petstore'],
      ['b', 1, 'Petstore'], // nested sub-environment keeps its depth + owning folder
      ['c', 0, 'Artifacts']
    ])
  })

  it('recurses into regular folders to find nested env folders', () => {
    const nested = envFolder('Nested', [{ id: 'n', name: 'staging' }])
    const regularFolderHoldingEnvFolder = { name: 'Group', items: [nested] }
    const collections = [regularFolderHoldingEnvFolder] as unknown as EnvironmentFolder[]

    const rows = collectAllEnvironments(collections)

    expect(rows.map((r) => r.env.id)).toEqual(['n'])
    expect(rows[0]?.groupLabel).toBe('Nested')
  })
})
