import { describe, it, expect } from 'vitest'
import { folderKind, findParentId, projectFolder, projectRequest, listChildren, flattenTree, buildTree } from './tree'
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
    fileFormatVersion: 1,
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
  })
})
