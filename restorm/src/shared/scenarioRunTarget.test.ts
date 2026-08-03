import { describe, it, expect } from 'vitest'
import type { FolderItem } from './types/collections'
import { collectScenarioTargets, suggestRunTarget, resolveRunTarget } from './scenarioRunTarget'

function ef(id: string, name: string, items: FolderItem[] = []): FolderItem {
  return { id, name, folderType: 'environment', tags: [], configuration: {}, items, environments: [] } as unknown as FolderItem
}
function f(id: string, name: string, items: FolderItem[] = []): FolderItem {
  return { id, name, tags: [], configuration: {}, items } as unknown as FolderItem
}
function sc(id: string, name: string): FolderItem {
  return { type: 'scenario', id, name, tags: [], params: [], nodes: [], edges: [], items: [] } as unknown as FolderItem
}

// Root/Main/{ Code (a), Code (b), Logs }   +   Root/Other/Code (c)
//  → "Code" appears 3× total, 2× in the SAME folder (Main).
const roots: FolderItem[] = [
  ef('root', 'Root', [
    f('main', 'Main', [sc('a', 'Code'), sc('b', 'Code'), sc('logs', 'Logs')]),
    f('other', 'Other', [sc('c', 'Code')])
  ])
]

describe('scenarioRunTarget', () => {
  it('computes name/breadcrumb/index path per scenario', () => {
    const targets = collectScenarioTargets(roots)
    const a = targets.find((t) => t.id === 'a')
    expect(a).toEqual({
      id: 'a', name: 'Code',
      breadcrumbPath: 'Root/Main/Code',
      indexPath: '1 - Root/1 - Main/1 - Code'
    })
    expect(targets.find((t) => t.id === 'b')?.indexPath).toBe('1 - Root/1 - Main/2 - Code')
    expect(targets.find((t) => t.id === 'c')?.indexPath).toBe('1 - Root/2 - Other/1 - Code')
  })

  describe('suggestRunTarget — shortest unambiguous', () => {
    it('bare name when unique', () => {
      expect(suggestRunTarget(roots, 'logs')).toBe('Logs')
    })
    it('breadcrumb when the name repeats but the path is unique', () => {
      expect(suggestRunTarget(roots, 'c')).toBe('Root/Other/Code')
    })
    it('index path when the same name is in the same folder', () => {
      expect(suggestRunTarget(roots, 'a')).toBe('1 - Root/1 - Main/1 - Code')
      expect(suggestRunTarget(roots, 'b')).toBe('1 - Root/1 - Main/2 - Code')
    })
  })

  describe('resolveRunTarget', () => {
    it('resolves a unique bare name', () => {
      expect(resolveRunTarget(roots, 'Logs')).toEqual({ id: 'logs' })
    })
    it('resolves a unique breadcrumb path', () => {
      expect(resolveRunTarget(roots, 'Root/Other/Code')).toEqual({ id: 'c' })
    })
    it('resolves an index path to the exact sibling', () => {
      expect(resolveRunTarget(roots, '1 - Root/1 - Main/1 - Code')).toEqual({ id: 'a' })
      expect(resolveRunTarget(roots, '1 - Root/1 - Main/2 - Code')).toEqual({ id: 'b' })
    })
    it('errors EXPLICITLY on an ambiguous name (crash loudly)', () => {
      const r = resolveRunTarget(roots, 'Code')
      expect('error' in r && r.error).toMatch(/ambiguous scenario 'Code' — 3 scenarios match/)
    })
    it('errors on a not-found target with the available list', () => {
      const r = resolveRunTarget(roots, 'Nope')
      expect('error' in r && r.error).toMatch(/no scenario named 'Nope'/)
      expect('error' in r && r.error).toMatch(/Root\/Main\/Code/)
    })
  })
})
