/**
 * Tests for CollectionStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron-core-ui/main to avoid Electron dependencies in tests
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    eventBusService: {
      emit: vi.fn().mockResolvedValue(undefined)
    },
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    createPubSub: () => ({
      publish: vi.fn(),
      subscribe: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: vi.fn() })
    }),
    serializeWithDecorators: vi.fn((_: unknown, data: unknown) => data)
  }
})

import { collectionStore } from '../../../src/main/services/CollectionStore'
import { Scenario } from '../../../src/shared/models'

describe('CollectionStore', () => {
  beforeEach(() => {
    collectionStore.clear()
  })

  describe('Collections', () => {
    it('should start with empty collections', () => {
      expect(collectionStore.getCollections()).toHaveLength(0)
    })

    it('should set collections', () => {
      const collections = [
        { id: 'col-1', name: 'Test Collection', items: [] }
      ]
      collectionStore.setCollections(collections)
      expect(collectionStore.getCollections()).toHaveLength(1)
      expect(collectionStore.getCollections()[0]?.name).toBe('Test Collection')
    })

    it('should clear collections', () => {
      collectionStore.setCollections([{ id: 'col-1', name: 'Test', items: [] }])
      collectionStore.clear()
      expect(collectionStore.getCollections()).toHaveLength(0)
    })
  })

  describe('Folders', () => {
    it('should create a root folder', () => {
      const folder = collectionStore.createFolder(null, { name: 'New Folder' })
      expect(folder.id).toBeDefined()
      expect(folder.name).toBe('New Folder')
      expect(collectionStore.getCollections()).toHaveLength(1)
    })

    it('should create a nested folder', () => {
      const parent = collectionStore.createFolder(null, { name: 'Parent' })
      const child = collectionStore.createFolder(parent.id, { name: 'Child' })
      
      expect(child.name).toBe('Child')
      const foundParent = collectionStore.findById(parent.id)
      expect(foundParent).toBeDefined()
      expect((foundParent as { items: unknown[] }).items).toHaveLength(1)
    })

    it('should update a folder', () => {
      const folder = collectionStore.createFolder(null, { name: 'Original' })
      const updated = collectionStore.updateFolder(folder.id, { name: 'Updated' })
      
      expect(updated?.name).toBe('Updated')
      expect(collectionStore.findById(folder.id)).toHaveProperty('name', 'Updated')
    })

    it('should delete a folder', () => {
      const folder = collectionStore.createFolder(null, { name: 'ToDelete' })
      const deleted = collectionStore.deleteFolder(folder.id)
      
      expect(deleted).toBe(true)
      expect(collectionStore.getCollections()).toHaveLength(0)
    })

    it('should find folder by ID', () => {
      const folder = collectionStore.createFolder(null, { name: 'Find Me' })
      const found = collectionStore.findById(folder.id)
      
      expect(found).toBeDefined()
      expect((found as { name: string }).name).toBe('Find Me')
    })

    it('should find parent folder', () => {
      const parent = collectionStore.createFolder(null, { name: 'Parent' })
      const child = collectionStore.createFolder(parent.id, { name: 'Child' })
      
      const foundParent = collectionStore.findParentFolder(child.id)
      expect(foundParent).toBeDefined()
      expect(foundParent?.id).toBe(parent.id)
    })
  })

  describe('Requests', () => {
    it('should create a request in a folder', () => {
      const folder = collectionStore.createFolder(null, { name: 'Folder' })
      const request = collectionStore.createRequest(folder.id, {
        name: 'My Request',
        type: 'http'
      })
      
      expect(request.id).toBeDefined()
      expect(request.name).toBe('My Request')
      expect(request.type).toBe('http')
    })

    it('should update a request', () => {
      const folder = collectionStore.createFolder(null, { name: 'Folder' })
      const request = collectionStore.createRequest(folder.id, {
        name: 'Original',
        type: 'http'
      })
      
      const updated = collectionStore.updateRequest(request.id, { name: 'Updated' })
      expect(updated?.name).toBe('Updated')
    })

    it('should delete a request', () => {
      const folder = collectionStore.createFolder(null, { name: 'Folder' })
      const request = collectionStore.createRequest(folder.id, {
        name: 'ToDelete',
        type: 'http'
      })
      
      const deleted = collectionStore.deleteRequest(request.id)
      expect(deleted).toBe(true)
      
      const found = collectionStore.findById(request.id)
      expect(found).toBeNull()
    })
  })

  describe('Environments', () => {
    it('should create an environment in an environment folder', () => {
      const folder = collectionStore.createFolder(null, {
        name: 'Env Folder',
        folderType: 'environment'
      })
      
      const env = collectionStore.createEnvironment(folder.id, {
        name: 'Development',
        variables: [{ key: 'API_URL', value: 'http://localhost' }]
      })
      
      expect(env.id).toBeDefined()
      expect(env.name).toBe('Development')
      expect(env.variables).toHaveLength(1)
    })

    it('should update an environment', () => {
      const folder = collectionStore.createFolder(null, {
        name: 'Env Folder',
        folderType: 'environment'
      })
      
      const env = collectionStore.createEnvironment(folder.id, {
        name: 'Original',
        variables: []
      })
      
      const updated = collectionStore.updateEnvironment(env.id, { name: 'Updated' })
      expect(updated?.name).toBe('Updated')
    })

    it('should delete an environment', () => {
      const folder = collectionStore.createFolder(null, {
        name: 'Env Folder',
        folderType: 'environment'
      })
      
      const env = collectionStore.createEnvironment(folder.id, {
        name: 'ToDelete',
        variables: []
      })
      
      const deleted = collectionStore.deleteEnvironment(env.id)
      expect(deleted).toBe(true)
      
      const found = collectionStore.findEnvironmentById(env.id)
      expect(found).toBeNull()
    })

    it('should find environment by ID', () => {
      const folder = collectionStore.createFolder(null, {
        name: 'Env Folder',
        folderType: 'environment'
      })
      
      const env = collectionStore.createEnvironment(folder.id, {
        name: 'Find Me',
        variables: []
      })
      
      const found = collectionStore.findEnvironmentById(env.id)
      expect(found).toBeDefined()
      expect(found?.name).toBe('Find Me')
    })
  })

  describe('Scenarios', () => {
    it('reifies a plain scenario in items into a Scenario instance (not a request)', () => {
      collectionStore.setCollections([
        {
          id: 'col-1',
          name: 'Root',
          folderType: 'environment',
          items: [
            {
              type: 'scenario',
              id: 'scn-1',
              name: 'Login flow',
              tags: [],
              params: [{ id: 'p1', name: 'user', dataType: 'string', required: true }],
              nodes: [{ id: 'n1', kind: 'start', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } }],
              edges: []
            }
          ]
        }
      ] as unknown as Parameters<typeof collectionStore.setCollections>[0])

      const root = collectionStore.getCollections()[0]
      const item = root?.items[0]
      // The bug guarded against: a scenario has `type` + no `items`, so
      // the request factory used to mis-build it as an HTTPRequest.
      expect(item).toBeInstanceOf(Scenario)
      const scenario = item as Scenario
      expect(scenario.type).toBe('scenario')
      expect(scenario.nodes).toHaveLength(1)
      expect(scenario.nodes[0]?.kind).toBe('start')
      expect(scenario.params[0]?.name).toBe('user')
      // Round-trips back to a plain object preserving the graph.
      const plain = scenario.toPlainObject()
      expect(plain.type).toBe('scenario')
      expect((plain.edges as unknown[])).toEqual([])
    })
  })
})
