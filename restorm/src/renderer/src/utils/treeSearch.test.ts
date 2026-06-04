import { describe, it, expect } from 'vitest'
import type { FolderItem } from '../../../shared/types/collections'
import {
  findRequestById,
  findItemById,
  findItemWithParent,
  findItemWithBreadcrumbs,
  findFolderById,
  findScenarioById
} from './treeSearch'

// Minimal fixtures — only the fields the guards + walkers read.
// A scenario doubles as a container: it holds a request and a sub-folder.
const reqInScenario = { type: 'http', id: 'req-in-scn', name: 'Inner request' }
const folderInScenario = { id: 'folder-in-scn', name: 'Inner folder', configuration: {}, items: [] }
const scenario = {
  type: 'scenario',
  id: 'scn',
  name: 'My scenario',
  tags: [],
  params: [],
  nodes: [],
  edges: [],
  items: [reqInScenario, folderInScenario]
}
const envFolder = {
  folderType: 'environment',
  id: 'env',
  name: 'Env folder',
  configuration: {},
  environments: [],
  items: [scenario]
}
const rootItems = [envFolder] as unknown as FolderItem[]

describe('treeSearch — scenarios are folder-like containers', () => {
  it('findRequestById descends into a scenario to find a child request', () => {
    expect(findRequestById(rootItems, 'req-in-scn')?.id).toBe('req-in-scn')
  })

  it('findItemById finds an item nested under a scenario', () => {
    expect(findItemById(rootItems, 'req-in-scn')?.id).toBe('req-in-scn')
  })

  it('findFolderById descends a scenario to find a sub-folder (but never returns the scenario as a folder)', () => {
    expect(findFolderById(rootItems, 'folder-in-scn')?.id).toBe('folder-in-scn')
    // The scenario itself is not a folder.
    expect(findFolderById(rootItems, 'scn')).toBeUndefined()
  })

  it('findScenarioById returns the live scenario nested under an env folder', () => {
    expect(findScenarioById(rootItems, 'scn')?.id).toBe('scn')
    // A request is not a scenario.
    expect(findScenarioById(rootItems, 'req-in-scn')).toBeUndefined()
  })

  it('findItemWithParent reports the scenario as the parent of its child request', () => {
    const { item, parent } = findItemWithParent(rootItems, 'req-in-scn')
    expect(item?.id).toBe('req-in-scn')
    expect(parent?.id).toBe('scn')
  })

  it('findItemWithBreadcrumbs includes the scenario in the path to a child request', () => {
    const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, 'req-in-scn')
    expect(item?.id).toBe('req-in-scn')
    expect(breadcrumbs.map((b) => b.id)).toEqual(['env', 'scn', 'req-in-scn'])
  })
})
