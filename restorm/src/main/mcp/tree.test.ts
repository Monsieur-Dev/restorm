import { describe, it, expect } from 'vitest'
import { folderKind, findParentId, projectFolder, projectRequest, listChildren, flattenTree, flattenScenarios, buildTree } from './tree'
import type { Folder, EnvironmentFolder, FolderItem } from '../../shared/models'

// Minimal stubs that satisfy the runtime predicates (`isFolder`,
// `isEnvironmentFolder`, `isRequest`). Real model classes carry many
// more fields, but the tree projection only reaches into `id` / `name`
// / `items` / `type` / `method`, so these are enough.

interface ReqStub { id: string; name: string; type: string; method?: string }

function f(id: string, name: string, items: FolderItem[] = []): Folder {
  return {
    id,
    name,
    documentation: '',
    tags: [],
    configuration: {} as Folder['configuration'],
    items
  } as Folder
}

function ef(id: string, name: string, items: FolderItem[] = []): EnvironmentFolder {
  return {
    id,
    name,
    folderType: 'environment',
    documentation: '',
    tags: [],
    configuration: {} as Folder['configuration'],
    items,
    environments: []
  } as EnvironmentFolder
}

function r(id: string, name: string, type = 'http', method?: string): FolderItem {
  return { id, name, type, ...(method !== undefined ? { method } : {}) } as unknown as FolderItem
}

// A scenario stub. `isScenario` keys on `type: 'scenario'`. Crucially it also
// carries `items` AND `configuration` to mirror the real runtime object — that
// combination makes `isFolder`/`isAnyFolder` return true for a scenario, so the
// projection has to test `isScenario` first or it mis-renders a scenario as a
// `kind: "folder"`. Leaving `configuration` off here would hide that bug.
function sc(
  id: string,
  name: string,
  opts: { nodes?: unknown[]; edges?: unknown[]; tags?: string[]; items?: FolderItem[] } = {}
): FolderItem {
  return {
    type: 'scenario',
    id,
    name,
    configuration: {},
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
    tags: opts.tags ?? [],
    items: opts.items ?? []
  } as unknown as FolderItem
}

describe('mcp/tree', () => {
  describe('folderKind', () => {
    it('returns "folder" for a plain folder', () => {
      expect(folderKind(f('a', 'A'))).toBe('folder')
    })

    it('returns "env-folder" for an environment folder', () => {
      expect(folderKind(ef('e', 'E'))).toBe('env-folder')
    })
  })

  describe('projectFolder / projectRequest', () => {
    it('projects a folder to its wire shape', () => {
      expect(projectFolder(f('a', 'A'), null)).toEqual({ id: 'a', name: 'A', kind: 'folder', parentId: null })
      expect(projectFolder(ef('e', 'E'), 'parent')).toEqual({ id: 'e', name: 'E', kind: 'env-folder', parentId: 'parent' })
    })

    it('projects a request including method when present', () => {
      const req = r('r1', 'List users', 'http', 'GET')
      expect(projectRequest(req as unknown as ReqStub as never, 'p')).toEqual({
        id: 'r1', name: 'List users', protocol: 'http', method: 'GET', parentId: 'p'
      })
    })

    it('omits method when not present', () => {
      const req = r('r2', 'subscribe', 'graphql')
      const out = projectRequest(req as unknown as ReqStub as never, null)
      expect(out).toEqual({ id: 'r2', name: 'subscribe', protocol: 'graphql', parentId: null })
      expect(out).not.toHaveProperty('method')
    })
  })

  describe('findParentId', () => {
    const root = ef('root', 'root', [
      f('mid', 'mid', [r('leaf-1', 'leaf')]),
      r('leaf-2', 'leaf2')
    ])

    it('returns null for the root itself', () => {
      expect(findParentId([root], 'root')).toBe(null)
    })

    it('finds direct child parent', () => {
      expect(findParentId([root], 'mid')).toBe('root')
      expect(findParentId([root], 'leaf-2')).toBe('root')
    })

    it('walks deep to find nested-child parent', () => {
      expect(findParentId([root], 'leaf-1')).toBe('mid')
    })

    it('returns null for an unknown id', () => {
      expect(findParentId([root], 'ghost')).toBe(null)
    })
  })

  describe('listChildren', () => {
    it('separates folders from requests under a parent', () => {
      const parent = ef('p', 'P', [
        f('sub-folder', 'sub'),
        ef('sub-env', 'env-sub'),
        r('req-1', 'r1'),
        r('req-2', 'r2', 'graphql')
      ])
      const { folders, requests } = listChildren(parent)
      expect(folders.map((x) => x.id)).toEqual(['sub-folder', 'sub-env'])
      expect(folders[1]?.kind).toBe('env-folder')
      expect(requests.map((x) => x.id)).toEqual(['req-1', 'req-2'])
    })

    it('does not list a child scenario as a folder', () => {
      const parent = f('p', 'P', [
        f('sub-folder', 'sub'),
        sc('scn', 'Scenario'),
        r('req-1', 'r1')
      ])
      const { folders, requests } = listChildren(parent)
      // The scenario carries `configuration` at runtime, so without the
      // `isScenario` guard it would leak into the folder list.
      expect(folders.map((x) => x.id)).toEqual(['sub-folder'])
      expect(requests.map((x) => x.id)).toEqual(['req-1'])
    })

    it('lists the requests authored directly inside a scenario container', () => {
      const scn = sc('scn', 'Scenario', { items: [f('sf', 'sf'), r('inner', 'inner', 'http', 'GET')] })
      const { folders, requests } = listChildren(scn as unknown as Folder)
      expect(folders.map((x) => x.id)).toEqual(['sf'])
      expect(requests).toEqual([
        { id: 'inner', name: 'inner', protocol: 'http', method: 'GET', parentId: 'scn' }
      ])
    })
  })

  describe('flattenTree', () => {
    it('walks every reachable item, attaching parentId', () => {
      const tree = [
        ef('root', 'root', [
          f('mid', 'mid', [r('rn', 'rn', 'http', 'POST')]),
          r('rt', 'rt')
        ])
      ]
      const { folders, requests } = flattenTree(tree)
      expect(folders).toEqual([
        { id: 'root', name: 'root', kind: 'env-folder', parentId: null },
        { id: 'mid', name: 'mid', kind: 'folder', parentId: 'root' }
      ])
      expect(requests).toEqual([
        { id: 'rn', name: 'rn', protocol: 'http', method: 'POST', parentId: 'mid' },
        { id: 'rt', name: 'rt', protocol: 'http', parentId: 'root' }
      ])
    })

    it('descends into a scenario container without listing it as a folder', () => {
      const tree = [
        ef('root', 'root', [
          sc('scn', 'Scenario', { items: [f('inner-folder', 'inner'), r('inner-req', 'inner-req', 'http', 'GET')] })
        ])
      ]
      const { folders, requests } = flattenTree(tree)
      // The scenario itself is not a folder; its inner folder + request are
      // still reachable, parented to the scenario id.
      expect(folders).toEqual([
        { id: 'root', name: 'root', kind: 'env-folder', parentId: null },
        { id: 'inner-folder', name: 'inner', kind: 'folder', parentId: 'scn' }
      ])
      expect(requests).toEqual([
        { id: 'inner-req', name: 'inner-req', protocol: 'http', method: 'GET', parentId: 'scn' }
      ])
    })

    it('handles a scenario and a request sitting AT the root, beside a collection', () => {
      const tree = [
        ef('coll', 'coll'),
        sc('root-scn', 'Root scenario', { items: [r('scn-req', 'scn-req', 'http', 'PUT')] }),
        r('root-req', 'root-req', 'http', 'GET')
      ]
      const { folders, requests } = flattenTree(tree)
      // The root scenario is not a folder — but its child request is reachable,
      // and the root request is listed with a null parent.
      expect(folders).toEqual([{ id: 'coll', name: 'coll', kind: 'env-folder', parentId: null }])
      expect(requests).toEqual([
        { id: 'scn-req', name: 'scn-req', protocol: 'http', method: 'PUT', parentId: 'root-scn' },
        { id: 'root-req', name: 'root-req', protocol: 'http', method: 'GET', parentId: null }
      ])
    })
  })

  describe('flattenScenarios', () => {
    it('collects scenarios anywhere in the tree with a folder-mode path + counts', () => {
      const tree = [
        ef('root', 'root', [
          sc('s-top', 'Top', { nodes: [{}, {}], edges: [{}], tags: ['smoke'] }),
          f('mid', 'mid', [
            r('rn', 'rn'),
            sc('s-deep', 'Deep', { nodes: [{}, {}, {}] })
          ])
        ])
      ]
      expect(flattenScenarios(tree)).toEqual([
        { id: 's-top', name: 'Top', path: 'root / Top', tags: ['smoke'], nodeCount: 2, edgeCount: 1, parentId: 'root' },
        { id: 's-deep', name: 'Deep', path: 'root / mid / Deep', tags: [], nodeCount: 3, edgeCount: 0, parentId: 'mid' }
      ])
    })

    it('descends into a scenario to surface a nested sub-scenario', () => {
      const tree = [
        ef('root', 'root', [
          sc('parent', 'Parent', { items: [sc('child', 'Child')] })
        ])
      ]
      expect(flattenScenarios(tree)).toEqual([
        { id: 'parent', name: 'Parent', path: 'root / Parent', tags: [], nodeCount: 0, edgeCount: 0, parentId: 'root' },
        { id: 'child', name: 'Child', path: 'root / Parent / Child', tags: [], nodeCount: 0, edgeCount: 0, parentId: 'parent' }
      ])
    })

    it('lists a scenario placed AT the root, and its sub-scenarios', () => {
      const tree = [
        ef('coll', 'coll'),
        sc('root-scn', 'Root scenario', { nodes: [{}], items: [sc('child', 'Child')] })
      ]
      // A root scenario has no ancestor container: its path is its own name and
      // its parentId is null. Walking only what the roots CONTAIN would omit it.
      expect(flattenScenarios(tree)).toEqual([
        { id: 'root-scn', name: 'Root scenario', path: 'Root scenario', tags: [], nodeCount: 1, edgeCount: 0, parentId: null },
        { id: 'child', name: 'Child', path: 'Root scenario / Child', tags: [], nodeCount: 0, edgeCount: 0, parentId: 'root-scn' }
      ])
    })

    it('returns an empty list when there are no scenarios', () => {
      expect(flattenScenarios([ef('root', 'root', [f('mid', 'mid', [r('rn', 'rn')])])])).toEqual([])
    })
  })

  describe('buildTree', () => {
    it('builds a hierarchical id+name tree with children + request leaves', () => {
      const tree = [
        ef('root', 'root', [
          f('mid', 'mid', [r('leaf', 'leaf', 'soap')])
        ])
      ]
      const out = buildTree(tree)
      expect(out).toEqual([
        {
          id: 'root',
          name: 'root',
          kind: 'env-folder',
          children: [
            {
              id: 'mid',
              name: 'mid',
              kind: 'folder',
              children: [
                { id: 'leaf', name: 'leaf', kind: 'request', protocol: 'soap' }
              ]
            }
          ]
        }
      ])
    })

    it('renders a scenario as a distinct "scenario" node with its child items', () => {
      const tree = [
        ef('root', 'root', [
          sc('scn', 'Scenario', { items: [r('inner', 'inner', 'graphql'), sc('child', 'Child')] })
        ])
      ]
      expect(buildTree(tree)).toEqual([
        {
          id: 'root',
          name: 'root',
          kind: 'env-folder',
          children: [
            {
              id: 'scn',
              name: 'Scenario',
              kind: 'scenario',
              children: [
                { id: 'inner', name: 'inner', kind: 'request', protocol: 'graphql' },
                { id: 'child', name: 'Child', kind: 'scenario', children: [] }
              ]
            }
          ]
        }
      ])
    })

    it('renders a root-level scenario and request as themselves, not as folders', () => {
      const tree = [
        ef('coll', 'coll'),
        sc('root-scn', 'Root scenario'),
        r('root-req', 'root-req', 'odata')
      ]
      expect(buildTree(tree)).toEqual([
        { id: 'coll', name: 'coll', kind: 'env-folder', children: [] },
        { id: 'root-scn', name: 'Root scenario', kind: 'scenario', children: [] },
        { id: 'root-req', name: 'root-req', kind: 'request', protocol: 'odata' }
      ])
    })
  })
})
