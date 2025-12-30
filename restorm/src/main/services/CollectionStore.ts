/**
 * Collection Store - Main process store for Restorm collections
 *
 * Manages the in-memory representation of collections, folders, requests, and environments.
 * Emits events when data changes for synchronization with the renderer process.
 */

import { eventBusService, logger } from 'electron-core-ui/main'
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload } from './DocumentEvents'

// ============================================================================
// Types
// ============================================================================

/** Base document type */
interface BaseDocument {
  id: string
  name: string
  type?: string
}

/** Environment type */
interface Environment extends BaseDocument {
  variables: { key: string; value: string; enabled?: boolean }[]
  subEnvironments?: Environment[]
}

/** Folder type */
interface Folder extends BaseDocument {
  items: FolderItem[]
  folderType?: 'standard' | 'environment'
  environments?: Environment[]
}

/** Request type */
interface Request extends BaseDocument {
  type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  url?: string
  method?: string
  headers?: { key: string; value: string }[]
  // ... other request properties
}

/** Folder item can be a folder or request */
type FolderItem = Folder | Request

/** Collection is the root folder */
type Collection = Folder

// ============================================================================
// Store Class
// ============================================================================

/**
 * Collection Store - Manages collections in the main process
 */
class CollectionStore {
  private collections: Collection[] = []

  // ==========================================================================
  // Getters
  // ==========================================================================

  /**
   * Get all collections
   */
  getCollections(): Collection[] {
    return this.collections
  }

  /**
   * Find an item by ID
   */
  findById(id: string): FolderItem | null {
    return this.findInItems(this.collections, id)
  }

  /**
   * Find an environment by ID
   */
  findEnvironmentById(id: string): Environment | null {
    for (const collection of this.collections) {
      const env = this.findEnvironmentInFolder(collection, id)
      if (env) return env
    }
    return null
  }

  /**
   * Find parent folder of an item
   */
  findParentFolder(itemId: string): Folder | null {
    for (const collection of this.collections) {
      const parent = this.findParentInFolder(collection, itemId)
      if (parent) return parent
    }
    return null
  }

  // ==========================================================================
  // Setters
  // ==========================================================================

  /**
   * Set all collections (used when loading from file)
   */
  setCollections(collections: Collection[], source: 'file-load' | 'user' = 'file-load'): void {
    this.collections = collections
    logger.info('[CollectionStore] Collections set', { count: collections.length, source })
  }

  /**
   * Clear all collections
   */
  clear(): void {
    this.collections = []
    logger.info('[CollectionStore] Collections cleared')
  }

  // ==========================================================================
  // Mutations - Folders
  // ==========================================================================

  /**
   * Create a new folder
   */
  createFolder(parentId: string | null, folder: Partial<Folder> & { name: string }): Folder {
    const newFolder: Folder = {
      ...folder,
      id: folder.id ?? this.generateId(),
      name: folder.name,
      items: folder.items ?? []
    } as Folder

    if (parentId === null) {
      // Add as root collection
      this.collections.push(newFolder)
    } else {
      // Add to parent folder
      const parent = this.findById(parentId) as Folder | null
      if (parent && 'items' in parent) {
        parent.items.push(newFolder)
      }
    }

    // Emit event
    this.emitFolderCreated(newFolder, parentId)
    return newFolder
  }

  /**
   * Update a folder
   */
  updateFolder(id: string, updates: Partial<Folder>): Folder | null {
    const folder = this.findById(id) as Folder | null
    if (!folder || !('items' in folder)) return null

    // Apply updates
    Object.assign(folder, updates)

    // Emit event
    this.emitFolderUpdated(folder)
    return folder
  }

  /**
   * Delete a folder
   */
  deleteFolder(id: string): boolean {
    const parent = this.findParentFolder(id)
    if (!parent) {
      // Check if it's a root collection
      const index = this.collections.findIndex(c => c.id === id)
      if (index !== -1) {
        this.collections.splice(index, 1)
        this.emitFolderDeleted(id)
        return true
      }
      return false
    }

    const index = parent.items.findIndex(item => item.id === id)
    if (index !== -1) {
      parent.items.splice(index, 1)
      this.emitFolderDeleted(id)
      return true
    }
    return false
  }

  /**
   * Move a folder to a new parent
   */
  moveFolder(id: string, newParentId: string, index: number): Folder | null {
    const folder = this.findById(id) as Folder | null
    if (!folder || !('items' in folder)) return null

    // Remove from current parent
    const currentParent = this.findParentFolder(id)
    if (currentParent) {
      const currentIndex = currentParent.items.findIndex(item => item.id === id)
      if (currentIndex !== -1) {
        currentParent.items.splice(currentIndex, 1)
      }
    } else {
      // It's a root collection
      const rootIndex = this.collections.findIndex(c => c.id === id)
      if (rootIndex !== -1) {
        this.collections.splice(rootIndex, 1)
      }
    }

    // Add to new parent
    const newParent = this.findById(newParentId) as Folder | null
    if (newParent && 'items' in newParent) {
      newParent.items.splice(index, 0, folder)
    }

    // Emit event
    this.emitFolderUpdated(folder)
    return folder
  }

  // ==========================================================================
  // Mutations - Requests
  // ==========================================================================

  /**
   * Create a new request
   */
  createRequest(parentId: string, request: Request): Request {
    const newRequest: Request = {
      ...request,
      id: request.id || this.generateId()
    }

    const parent = this.findById(parentId) as Folder | null
    if (parent && 'items' in parent) {
      parent.items.push(newRequest)
    }

    // Emit event
    this.emitRequestCreated(newRequest, parentId)
    return newRequest
  }

  /**
   * Update a request
   */
  updateRequest(id: string, updates: Partial<Request>): Request | null {
    const request = this.findById(id) as Request | null
    if (!request?.type) return null

    // Apply updates
    Object.assign(request, updates)

    // Emit event
    this.emitRequestUpdated(request)
    return request
  }

  /**
   * Delete a request
   */
  deleteRequest(id: string): boolean {
    const parent = this.findParentFolder(id)
    if (!parent) return false

    const index = parent.items.findIndex(item => item.id === id)
    if (index !== -1) {
      parent.items.splice(index, 1)
      this.emitRequestDeleted(id)
      return true
    }
    return false
  }

  /**
   * Move a request to a new parent
   */
  moveRequest(id: string, newParentId: string, index: number): Request | null {
    const request = this.findById(id) as Request | null
    if (!request?.type) return null

    // Remove from current parent
    const currentParent = this.findParentFolder(id)
    if (currentParent) {
      const currentIndex = currentParent.items.findIndex(item => item.id === id)
      if (currentIndex !== -1) {
        currentParent.items.splice(currentIndex, 1)
      }
    }

    // Add to new parent
    const newParent = this.findById(newParentId) as Folder | null
    if (newParent && 'items' in newParent) {
      newParent.items.splice(index, 0, request)
    }

    // Emit event
    this.emitRequestUpdated(request)
    return request
  }

  // ==========================================================================
  // Mutations - Environments
  // ==========================================================================

  /**
   * Create a new environment
   */
  createEnvironment(parentId: string, environment: Partial<Environment> & { name: string }, parentEnvironmentId?: string): Environment {
    const newEnv: Environment = {
      ...environment,
      id: environment.id ?? this.generateId(),
      name: environment.name,
      variables: environment.variables ?? []
    } as Environment

    if (parentEnvironmentId) {
      // Add as sub-environment
      const parentEnv = this.findEnvironmentById(parentEnvironmentId)
      if (parentEnv) {
        parentEnv.subEnvironments ??= []
        parentEnv.subEnvironments.push(newEnv)
      }
    } else {
      // Add to folder
      const folder = this.findById(parentId) as Folder | null
      if (folder?.folderType === 'environment') {
        folder.environments ??= []
        folder.environments.push(newEnv)
      }
    }

    // Emit event
    this.emitEnvironmentCreated(newEnv, parentId, parentEnvironmentId)
    return newEnv
  }

  /**
   * Update an environment
   */
  updateEnvironment(id: string, updates: Partial<Environment>): Environment | null {
    const env = this.findEnvironmentById(id)
    if (!env) return null

    // Apply updates
    Object.assign(env, updates)

    // Emit event
    this.emitEnvironmentUpdated(env)
    return env
  }

  /**
   * Delete an environment
   */
  deleteEnvironment(id: string): boolean {
    for (const collection of this.collections) {
      if (this.deleteEnvironmentFromFolder(collection, id)) {
        this.emitEnvironmentDeleted(id)
        return true
      }
    }
    return false
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private findInItems(items: FolderItem[], id: string): FolderItem | null {
    for (const item of items) {
      if (item.id === id) return item
      if ('items' in item) {
        const found = this.findInItems(item.items, id)
        if (found) return found
      }
    }
    return null
  }

  private findEnvironmentInFolder(folder: Folder, id: string): Environment | null {
    if (folder.environments) {
      for (const env of folder.environments) {
        if (env.id === id) return env
        const found = this.findInSubEnvironments(env.subEnvironments, id)
        if (found) return found
      }
    }
    for (const item of folder.items) {
      if ('items' in item) {
        const found = this.findEnvironmentInFolder(item, id)
        if (found) return found
      }
    }
    return null
  }

  private findInSubEnvironments(subEnvs: Environment[] | undefined, id: string): Environment | null {
    if (!subEnvs) return null
    for (const env of subEnvs) {
      if (env.id === id) return env
      const found = this.findInSubEnvironments(env.subEnvironments, id)
      if (found) return found
    }
    return null
  }

  private findParentInFolder(folder: Folder, itemId: string): Folder | null {
    for (const item of folder.items) {
      if (item.id === itemId) return folder
      if ('items' in item) {
        const found = this.findParentInFolder(item, itemId)
        if (found) return found
      }
    }
    return null
  }

  private deleteEnvironmentFromFolder(folder: Folder, id: string): boolean {
    if (folder.environments) {
      const index = folder.environments.findIndex(env => env.id === id)
      if (index !== -1) {
        folder.environments.splice(index, 1)
        return true
      }
      for (const env of folder.environments) {
        if (this.deleteFromSubEnvironments(env, id)) return true
      }
    }
    for (const item of folder.items) {
      if ('items' in item) {
        if (this.deleteEnvironmentFromFolder(item, id)) return true
      }
    }
    return false
  }

  private deleteFromSubEnvironments(parent: Environment, id: string): boolean {
    if (!parent.subEnvironments) return false
    const index = parent.subEnvironments.findIndex(env => env.id === id)
    if (index !== -1) {
      parent.subEnvironments.splice(index, 1)
      return true
    }
    for (const env of parent.subEnvironments) {
      if (this.deleteFromSubEnvironments(env, id)) return true
    }
    return false
  }

  private generateId(): string {
    return crypto.randomUUID()
  }

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  private emitFolderCreated(folder: Folder, parentId: string | null): void {
    const payload: DocumentChangedPayload = {
      id: folder.id,
      type: 'folder',
      document: folder,
      parentFolderId: parentId ?? undefined
    }
    void eventBusService.emit(DocumentEvents.FOLDER_CREATED, payload)
    logger.debug('[CollectionStore] Folder created', { id: folder.id, name: folder.name })
  }

  private emitFolderUpdated(folder: Folder): void {
    const payload: DocumentChangedPayload = {
      id: folder.id,
      type: 'folder',
      document: folder
    }
    void eventBusService.emit(DocumentEvents.FOLDER_UPDATED, payload)
    logger.debug('[CollectionStore] Folder updated', { id: folder.id, name: folder.name })
  }

  private emitFolderDeleted(id: string): void {
    const payload: DocumentDeletedPayload = {
      id,
      type: 'folder'
    }
    void eventBusService.emit(DocumentEvents.FOLDER_DELETED, payload)
    logger.debug('[CollectionStore] Folder deleted', { id })
  }

  private emitRequestCreated(request: Request, parentId: string): void {
    const payload: DocumentChangedPayload = {
      id: request.id,
      type: 'request',
      document: request,
      parentFolderId: parentId
    }
    void eventBusService.emit(DocumentEvents.REQUEST_CREATED, payload)
    logger.debug('[CollectionStore] Request created', { id: request.id, name: request.name })
  }

  private emitRequestUpdated(request: Request): void {
    const payload: DocumentChangedPayload = {
      id: request.id,
      type: 'request',
      document: request
    }
    void eventBusService.emit(DocumentEvents.REQUEST_UPDATED, payload)
    logger.debug('[CollectionStore] Request updated', { id: request.id, name: request.name })
  }

  private emitRequestDeleted(id: string): void {
    const payload: DocumentDeletedPayload = {
      id,
      type: 'request'
    }
    void eventBusService.emit(DocumentEvents.REQUEST_DELETED, payload)
    logger.debug('[CollectionStore] Request deleted', { id })
  }

  private emitEnvironmentCreated(env: Environment, parentId: string, parentEnvironmentId?: string): void {
    const payload: DocumentChangedPayload = {
      id: env.id,
      type: 'environment',
      document: env,
      parentFolderId: parentId,
      parentEnvironmentId
    }
    void eventBusService.emit(DocumentEvents.ENVIRONMENT_CREATED, payload)
    logger.debug('[CollectionStore] Environment created', { id: env.id, name: env.name })
  }

  private emitEnvironmentUpdated(env: Environment): void {
    const payload: DocumentChangedPayload = {
      id: env.id,
      type: 'environment',
      document: env
    }
    void eventBusService.emit(DocumentEvents.ENVIRONMENT_UPDATED, payload)
    logger.debug('[CollectionStore] Environment updated', { id: env.id, name: env.name })
  }

  private emitEnvironmentDeleted(id: string): void {
    const payload: DocumentDeletedPayload = {
      id,
      type: 'environment'
    }
    void eventBusService.emit(DocumentEvents.ENVIRONMENT_DELETED, payload)
    logger.debug('[CollectionStore] Environment deleted', { id })
  }
}

// Singleton instance
export const collectionStore = new CollectionStore()
