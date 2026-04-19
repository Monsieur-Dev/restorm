/**
 * Unit tests for renderer utility functions used by custom React hooks.
 *
 * Covers: treeSearch, treeManipulation, requestPath, badgeUtils
 */

import { describe, it, expect } from 'vitest'
import type { Folder, EnvironmentFolder, FolderItem } from '../../../src/shared/types/collections'
import type { BreadcrumbItem } from '../../../src/shared/types/editor'
import type { HTTPRequest } from '../../../src/shared/types/requests/HTTPRequest'

import {
  findFolderById,
  findEnvironmentFolderById,
  findRequestById,
  findItemById,
  findItemWithBreadcrumbs,
  findItemWithParent,
  getNearestEnvironmentsForBreadcrumbs,
  getFolderIcon
} from '../../../src/renderer/src/utils/treeSearch'

import {
  deepCloneItem,
  removeItemFromTree,
  insertItemIntoTree,
  cloneItemInTree
} from '../../../src/renderer/src/utils/treeManipulation'

import { buildRequestPath } from '../../../src/renderer/src/utils/requestPath'
import { mapToBadgeType } from '../../../src/renderer/src/utils/badgeUtils'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRequest(id: string, name: string): HTTPRequest {
  return {
    id,
    name,
    type: 'http',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    documentation: '',
    tags: []
  }
}

function makeFolder(id: string, name: string, items: FolderItem[] = []): Folder {
  return { id, name, documentation: '', tags: [], configuration: {}, items }
}

function makeEnvFolder(
  id: string,
  name: string,
  items: FolderItem[] = [],
  environments: EnvironmentFolder['environments'] = []
): EnvironmentFolder {
  return {
    id,
    name,
    folderType: 'environment',
    fileFormatVersion: 1,
    documentation: '',
    tags: [],
    configuration: {},
    items,
    environments
  }
}

/**
 * Builds a standard tree used by many tests:
 *
 *  envRoot (EnvironmentFolder)
 *    ├── subFolder (Folder)
 *    │     └── req1 (HTTPRequest)
 *    └── req2 (HTTPRequest)
 */
function buildTree(): { envRoot: EnvironmentFolder; subFolder: Folder; req1: HTTPRequest; req2: HTTPRequest } {
  const req1 = makeRequest('req-1', 'Get Users')
  const req2 = makeRequest('req-2', 'Create User')
  const subFolder = makeFolder('sub-1', 'Users', [req1])
  const envRoot = makeEnvFolder('env-root', 'API Collection', [subFolder, req2], [
    { id: 'env-1', name: 'Development', variables: [{ key: 'host', value: 'localhost' }] }
  ])
  return { envRoot, subFolder, req1, req2 }
}

// ---------------------------------------------------------------------------
// treeSearch
// ---------------------------------------------------------------------------

describe('treeSearch', () => {
  describe('getFolderIcon', () => {
    it('returns codicon folder for a regular folder', () => {
      const folder = makeFolder('f1', 'F')
      expect(getFolderIcon(folder)).toEqual({ type: 'codicon', value: 'folder' })
    })

    it('returns codicon folder-library for an environment folder', () => {
      const env = makeEnvFolder('e1', 'E')
      expect(getFolderIcon(env)).toEqual({ type: 'codicon', value: 'folder-library' })
    })
  })

  describe('findFolderById', () => {
    it('finds a root-level environment folder', () => {
      const { envRoot } = buildTree()
      expect(findFolderById([envRoot], 'env-root')).toBe(envRoot)
    })

    it('finds a nested folder', () => {
      const { envRoot, subFolder } = buildTree()
      expect(findFolderById([envRoot], 'sub-1')).toBe(subFolder)
    })

    it('returns undefined for a request id', () => {
      const { envRoot } = buildTree()
      expect(findFolderById([envRoot], 'req-1')).toBeUndefined()
    })

    it('returns undefined when id does not exist', () => {
      const { envRoot } = buildTree()
      expect(findFolderById([envRoot], 'nonexistent')).toBeUndefined()
    })

    it('skips root-level requests', () => {
      const req = makeRequest('r-root', 'Root Req')
      expect(findFolderById([req], 'r-root')).toBeUndefined()
    })
  })

  describe('findEnvironmentFolderById', () => {
    it('finds the env folder at root', () => {
      const { envRoot } = buildTree()
      expect(findEnvironmentFolderById([envRoot], 'env-root')).toBe(envRoot)
    })

    it('returns undefined for a regular folder id', () => {
      const { envRoot } = buildTree()
      expect(findEnvironmentFolderById([envRoot], 'sub-1')).toBeUndefined()
    })
  })

  describe('findRequestById', () => {
    it('finds a nested request', () => {
      const { envRoot, req1 } = buildTree()
      expect(findRequestById([envRoot], 'req-1')).toBe(req1)
    })

    it('finds a root-level request', () => {
      const req = makeRequest('r-root', 'Root Req')
      expect(findRequestById([req], 'r-root')).toBe(req)
    })

    it('returns undefined for a folder id', () => {
      const { envRoot } = buildTree()
      expect(findRequestById([envRoot], 'sub-1')).toBeUndefined()
    })
  })

  describe('findItemById', () => {
    it('finds folders', () => {
      const { envRoot, subFolder } = buildTree()
      expect(findItemById([envRoot], 'sub-1')).toBe(subFolder)
    })

    it('finds requests', () => {
      const { envRoot, req2 } = buildTree()
      expect(findItemById([envRoot], 'req-2')).toBe(req2)
    })

    it('returns null for missing id', () => {
      const { envRoot } = buildTree()
      expect(findItemById([envRoot], 'missing')).toBeNull()
    })
  })

  describe('findItemWithBreadcrumbs', () => {
    it('builds breadcrumbs to a nested request', () => {
      const { envRoot } = buildTree()
      const result = findItemWithBreadcrumbs([envRoot], 'req-1')
      expect(result.item).not.toBeNull()
      expect(result.breadcrumbs).toHaveLength(3) // envRoot -> subFolder -> req1
      expect(result.breadcrumbs[0]?.label).toBe('API Collection')
      expect(result.breadcrumbs[1]?.label).toBe('Users')
      expect(result.breadcrumbs[2]?.label).toBe('Get Users')
    })

    it('builds breadcrumbs to a root folder', () => {
      const { envRoot } = buildTree()
      const result = findItemWithBreadcrumbs([envRoot], 'env-root')
      expect(result.item).toBe(envRoot)
      expect(result.breadcrumbs).toHaveLength(1)
    })

    it('returns empty breadcrumbs for missing id', () => {
      const { envRoot } = buildTree()
      const result = findItemWithBreadcrumbs([envRoot], 'missing')
      expect(result.item).toBeNull()
      expect(result.breadcrumbs).toEqual([])
    })

    it('returns icon with breadcrumbs for env folders', () => {
      const { envRoot } = buildTree()
      const result = findItemWithBreadcrumbs([envRoot], 'sub-1')
      // envRoot breadcrumb should have env folder icon, subFolder should have folder icon
      expect(result.breadcrumbs[0]?.icon).toEqual({ type: 'codicon', value: 'folder-library' })
      expect(result.breadcrumbs[1]?.icon).toEqual({ type: 'codicon', value: 'folder' })
    })
  })

  describe('findItemWithParent', () => {
    it('finds item and its parent folder', () => {
      const { envRoot, req1, subFolder } = buildTree()
      const result = findItemWithParent([envRoot], 'req-1')
      expect(result.item).toBe(req1)
      expect(result.parent).toBe(subFolder)
      expect(result.index).toBe(0)
    })

    it('returns null parent for root-level item', () => {
      const { envRoot } = buildTree()
      const result = findItemWithParent([envRoot], 'env-root')
      expect(result.item).toBe(envRoot)
      expect(result.parent).toBeNull()
    })

    it('returns null item for missing id', () => {
      const { envRoot } = buildTree()
      const result = findItemWithParent([envRoot], 'nope')
      expect(result.item).toBeNull()
    })
  })

  describe('getNearestEnvironmentsForBreadcrumbs', () => {
    it('returns environments from nearest ancestor environment folder', () => {
      const { envRoot } = buildTree()
      const breadcrumbs: BreadcrumbItem[] = [
        { id: 'env-root', label: 'API Collection' },
        { id: 'sub-1', label: 'Users' },
        { id: 'req-1', label: 'Get Users' }
      ]
      const envs = getNearestEnvironmentsForBreadcrumbs([envRoot], breadcrumbs)
      expect(envs).toHaveLength(1)
      expect(envs[0]?.name).toBe('Development')
    })

    it('returns empty array when no environment folder in path', () => {
      const folder = makeFolder('f1', 'Plain', [makeRequest('r1', 'R')])
      const breadcrumbs: BreadcrumbItem[] = [
        { id: 'f1', label: 'Plain' },
        { id: 'r1', label: 'R' }
      ]
      expect(getNearestEnvironmentsForBreadcrumbs([folder], breadcrumbs)).toEqual([])
    })

    it('returns empty array for empty breadcrumbs', () => {
      const { envRoot } = buildTree()
      expect(getNearestEnvironmentsForBreadcrumbs([envRoot], [])).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// treeManipulation
// ---------------------------------------------------------------------------

describe('treeManipulation', () => {
  describe('deepCloneItem', () => {
    it('clones a request with a new id and "(copy)" suffix', () => {
      const req = makeRequest('r1', 'My Request')
      const clone = deepCloneItem(req)
      expect(clone.id).not.toBe('r1')
      expect(clone.name).toBe('My Request (copy)')
    })

    it('recursively clones folder children with new ids', () => {
      const { subFolder } = buildTree()
      const clone = deepCloneItem(subFolder)
      expect(clone.id).not.toBe(subFolder.id)
      expect('items' in clone && clone.items.length).toBe(1)
      if ('items' in clone) {
        expect(clone.items[0]?.id).not.toBe('req-1')
      }
    })
  })

  describe('removeItemFromTree', () => {
    it('removes a request and returns it', () => {
      const { envRoot, subFolder, req1 } = buildTree()
      const removed = removeItemFromTree([envRoot], 'req-1')
      expect(removed).toBe(req1)
      expect(subFolder.items).toHaveLength(0)
    })

    it('returns null for missing item', () => {
      const { envRoot } = buildTree()
      expect(removeItemFromTree([envRoot], 'nope')).toBeNull()
    })
  })

  describe('insertItemIntoTree', () => {
    it('inserts into a folder', () => {
      const { envRoot, subFolder } = buildTree()
      const newReq = makeRequest('r-new', 'New')
      const ok = insertItemIntoTree([envRoot], newReq, 'sub-1', 'into')
      expect(ok).toBe(true)
      expect(subFolder.items).toContain(newReq)
    })

    it('inserts before a sibling', () => {
      const { envRoot } = buildTree()
      const newReq = makeRequest('r-new', 'New')
      // Insert before req2 which is at index 1 in envRoot.items
      const ok = insertItemIntoTree([envRoot], newReq, 'req-2', 'before')
      expect(ok).toBe(true)
      expect(envRoot.items[1]?.id).toBe('r-new')
    })

    it('inserts after a sibling', () => {
      const { envRoot } = buildTree()
      const newReq = makeRequest('r-new', 'New')
      const ok = insertItemIntoTree([envRoot], newReq, 'sub-1', 'after')
      expect(ok).toBe(true)
      expect(envRoot.items[1]?.id).toBe('r-new')
    })

    it('returns false for unknown target', () => {
      const { envRoot } = buildTree()
      const newReq = makeRequest('r-new', 'New')
      expect(insertItemIntoTree([envRoot], newReq, 'nope', 'into')).toBe(false)
    })
  })

  describe('cloneItemInTree', () => {
    it('clones an item and inserts after it', () => {
      const { envRoot, subFolder } = buildTree()
      const clone = cloneItemInTree([envRoot], 'req-1')
      expect(clone).not.toBeNull()
      expect(subFolder.items).toHaveLength(2)
      expect(subFolder.items[1]?.name).toBe('Get Users (copy)')
    })

    it('returns null for missing item', () => {
      const { envRoot } = buildTree()
      expect(cloneItemInTree([envRoot], 'nope')).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// requestPath
// ---------------------------------------------------------------------------

describe('requestPath / buildRequestPath', () => {
  it('builds a path for a request in a nested folder', () => {
    const req = makeRequest('r1', 'Get Users')
    const inner = makeFolder('f2', 'Users', [req])
    const col = makeEnvFolder('c1', 'API', [inner])
    const path = buildRequestPath([col], 'r1')
    expect(path).not.toBeNull()
    expect(path).toContain('API')
    expect(path).toContain('Users')
    expect(path).toContain('Get Users')
  })

  it('returns null when request not found', () => {
    const col = makeEnvFolder('c1', 'API', [])
    expect(buildRequestPath([col], 'missing')).toBeNull()
  })

  it('zero-pads indices based on sibling count', () => {
    // With 10+ items the index should be zero-padded to width 2
    const requests = Array.from({ length: 12 }, (_, i) => makeRequest(`r${i}`, `Req ${i}`))
    const col = makeEnvFolder('c1', 'Col', requests)
    const path = buildRequestPath([col], 'r0')
    // First item: index 0 -> formatted as "01"
    expect(path).toMatch(/01 - Req 0/)
  })

  it('sanitizes special characters in names', () => {
    const req = makeRequest('r1', 'Get <Users>: "all"')
    const col = makeEnvFolder('c1', 'API', [req])
    const path = buildRequestPath([col], 'r1')
    expect(path).not.toBeNull()
    // Angle brackets and quotes should be replaced with underscores
    expect(path).not.toContain('<')
    expect(path).not.toContain('>')
    expect(path).not.toContain('"')
  })
})

// ---------------------------------------------------------------------------
// badgeUtils
// ---------------------------------------------------------------------------

describe('badgeUtils / mapToBadgeType', () => {
  it('maps HTTP methods to uppercase', () => {
    expect(mapToBadgeType('get')).toBe('GET')
    expect(mapToBadgeType('post')).toBe('POST')
    expect(mapToBadgeType('delete')).toBe('DELETE')
    expect(mapToBadgeType('PATCH')).toBe('PATCH')
  })

  it('maps gRPC call types', () => {
    expect(mapToBadgeType('unary')).toBe('UNARY')
    expect(mapToBadgeType('server-stream')).toBe('S-STR')
    expect(mapToBadgeType('client-streaming')).toBe('C-STR')
    expect(mapToBadgeType('bidi')).toBe('BIDI')
  })

  it('maps GraphQL operation types', () => {
    expect(mapToBadgeType('query')).toBe('QUERY')
    expect(mapToBadgeType('mutation')).toBe('MUTATION')
    expect(mapToBadgeType('subscription')).toBe('SUBSCRIPTION')
    expect(mapToBadgeType('gql')).toBe('GQL')
  })

  it('maps WebSocket protocols', () => {
    expect(mapToBadgeType('ws')).toBe('WS')
    expect(mapToBadgeType('socket.io')).toBe('SIO')
    expect(mapToBadgeType('mqtt')).toBe('MQTT')
  })

  it('maps SOAP', () => {
    expect(mapToBadgeType('soap')).toBe('SOAP')
  })

  it('falls back to uppercased value for unknown input', () => {
    expect(mapToBadgeType('custom')).toBe('CUSTOM')
  })
})
