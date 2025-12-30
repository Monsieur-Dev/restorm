/**
 * Tests for CollectionStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock electron-core-ui/main to avoid Electron dependencies in tests
vi.mock('electron-core-ui/main', () => ({
  eventBusService: {
    emit: vi.fn().mockResolvedValue(undefined)
  },
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { collectionStore } from '../../../src/main/services/CollectionStore'

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
})

