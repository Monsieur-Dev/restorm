import { describe, it, expect } from 'vitest'
import { findTopLevelEnvironment } from './envSaveUnit'
import type { Environment, FolderItem } from '../../../shared/types/collections'

// Minimal env / env-folder shapes — only the fields the resolver reads.
const env = (id: string, subEnvironments?: Environment[]): Environment =>
  ({ id, name: id, variables: [], ...(subEnvironments ? { subEnvironments } : {}) }) as unknown as Environment

const envFolder = (id: string, environments: Environment[]): FolderItem =>
  ({ id, name: id, folderType: 'environment', environments, items: [] }) as unknown as FolderItem

const folder = (id: string, items: FolderItem[]): FolderItem =>
  ({ id, name: id, items }) as unknown as FolderItem

describe('findTopLevelEnvironment', () => {
  // ef ─ A ─ B ─ C
  //    └ D
  const tree: FolderItem[] = [
    envFolder('ef', [env('A', [env('B', [env('C')])]), env('D')])
  ]

  it('returns a top-level env as itself', () => {
    expect(findTopLevelEnvironment(tree, 'ef', 'A')?.id).toBe('A')
    expect(findTopLevelEnvironment(tree, 'ef', 'D')?.id).toBe('D')
  })

  it('returns the top-level ancestor for a nested sub-environment', () => {
    expect(findTopLevelEnvironment(tree, 'ef', 'B')?.id).toBe('A')
    expect(findTopLevelEnvironment(tree, 'ef', 'C')?.id).toBe('A')
  })

  it('finds an env-folder nested under a plain folder', () => {
    const nested: FolderItem[] = [folder('root', [envFolder('ef2', [env('X', [env('Y')])])])]
    expect(findTopLevelEnvironment(nested, 'ef2', 'Y')?.id).toBe('X')
  })

  it('returns null for an unknown env or folder', () => {
    expect(findTopLevelEnvironment(tree, 'ef', 'Z')).toBeNull()
    expect(findTopLevelEnvironment(tree, 'missing', 'A')).toBeNull()
  })
})
