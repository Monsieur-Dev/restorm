/**
 * Collection Store - Main process store for Restorm collections
 *
 * Manages the in-memory representation of collections, folders, requests, and environments.
 * Uses decorated model classes and publishes events via GraphQL PubSub.
 */

import { eventBusService, logger, createPubSub, serializeWithDecorators } from 'electron-core-ui/main'
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload } from './DocumentEvents'
import {
  Folder,
  EnvironmentFolder,
  Environment,
  KeyValue,
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  ODataRequest,
  AuthenticationRequest,
  isEnvironmentFolder,
  isAnyFolder,
  type FolderItem,
  type Request
} from '../../shared/models'

// ============================================================================
// PubSub Topics
// ============================================================================

export const PUBSUB_TOPICS = {
  FOLDER_CREATED: 'FOLDER_CREATED',
  FOLDER_UPDATED: 'FOLDER_UPDATED',
  FOLDER_DELETED: 'FOLDER_DELETED',
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_UPDATED: 'REQUEST_UPDATED',
  REQUEST_DELETED: 'REQUEST_DELETED',
  ENVIRONMENT_CREATED: 'ENVIRONMENT_CREATED',
  ENVIRONMENT_UPDATED: 'ENVIRONMENT_UPDATED',
  ENVIRONMENT_DELETED: 'ENVIRONMENT_DELETED',
  CONTEXT_CHANGED: 'CONTEXT_CHANGED',
  SEARCH_INDEX_UPDATED: 'SEARCH_INDEX_UPDATED'
} as const

// Create PubSub instance for GraphQL subscriptions
export const pubsub = createPubSub<{
  [PUBSUB_TOPICS.FOLDER_CREATED]: [Folder | EnvironmentFolder]
  [PUBSUB_TOPICS.FOLDER_UPDATED]: [Folder | EnvironmentFolder]
  [PUBSUB_TOPICS.FOLDER_DELETED]: [string]
  [PUBSUB_TOPICS.REQUEST_CREATED]: [Request]
  [PUBSUB_TOPICS.REQUEST_UPDATED]: [Request]
  [PUBSUB_TOPICS.REQUEST_DELETED]: [string]
  [PUBSUB_TOPICS.ENVIRONMENT_CREATED]: [Environment]
  [PUBSUB_TOPICS.ENVIRONMENT_UPDATED]: [Environment]
  [PUBSUB_TOPICS.ENVIRONMENT_DELETED]: [string]
  [PUBSUB_TOPICS.CONTEXT_CHANGED]: [string, { environmentId: string; variables: { key: string; value: string; resolved: string }[] }]
  [PUBSUB_TOPICS.SEARCH_INDEX_UPDATED]: [string, { action: 'indexed' | 'removed'; documentId: string; documentType: string }]
}>()

// ============================================================================
// Type for collection (root folder)
// ============================================================================

type Collection = EnvironmentFolder

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
  findParentFolder(itemId: string): Folder | EnvironmentFolder | null {
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
    // Convert plain objects to class instances if needed
    this.collections = collections.map(c => this.ensureEnvironmentFolderInstance(c))
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
  createFolder(parentId: string | null, folderData: Partial<Folder> & { name: string }): Folder {
    const newFolder = new Folder({
      ...folderData,
      id: folderData.id ?? this.generateId(),
      name: folderData.name,
      items: folderData.items ?? []
    })

    if (parentId === null) {
      // Create as EnvironmentFolder at root
      const envFolder = new EnvironmentFolder({
        id: newFolder.id,
        name: newFolder.name,
        documentation: newFolder.documentation,
        notes: newFolder.notes,
        tags: newFolder.tags,
        items: [],
        environments: []
      })
      this.collections.push(envFolder)
      this.emitFolderCreated(envFolder, parentId)
      return envFolder
    }

    // Add to parent folder
    const parent = this.findById(parentId)
    if (parent && isAnyFolder(parent)) {
      parent.items.push(newFolder)
    }

    // Emit events
    this.emitFolderCreated(newFolder, parentId)
    return newFolder
  }

  /**
   * Update a folder
   */
  updateFolder(id: string, updates: Partial<Folder>): Folder | EnvironmentFolder | null {
    const folder = this.findById(id)
    if (!folder || !isAnyFolder(folder)) return null

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
  moveFolder(id: string, newParentId: string, index: number): Folder | EnvironmentFolder | null {
    const folder = this.findById(id)
    if (!folder || !isAnyFolder(folder)) return null

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
    const newParent = this.findById(newParentId)
    if (newParent && isAnyFolder(newParent)) {
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
  createRequest(parentId: string, requestData: Partial<Request> & { type: Request['type']; name: string }): Request {
    const newRequest = this.createRequestInstance(requestData)
    newRequest.id = requestData.id ?? this.generateId()

    const parent = this.findById(parentId)
    if (parent && isAnyFolder(parent)) {
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
    if (!request || !('type' in request) || isAnyFolder(request)) return null

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
    if (!request || !('type' in request) || isAnyFolder(request)) return null

    // Remove from current parent
    const currentParent = this.findParentFolder(id)
    if (currentParent) {
      const currentIndex = currentParent.items.findIndex(item => item.id === id)
      if (currentIndex !== -1) {
        currentParent.items.splice(currentIndex, 1)
      }
    }

    // Add to new parent
    const newParent = this.findById(newParentId)
    if (newParent && isAnyFolder(newParent)) {
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
  createEnvironment(parentId: string, environmentData: Partial<Environment> & { name: string }, parentEnvironmentId?: string): Environment {
    const newEnv = new Environment({
      ...environmentData,
      id: environmentData.id ?? this.generateId(),
      name: environmentData.name,
      variables: environmentData.variables?.map(v => v instanceof KeyValue ? v : KeyValue.fromPlain(v)) ?? []
    })

    if (parentEnvironmentId) {
      // Add as sub-environment
      const parentEnv = this.findEnvironmentById(parentEnvironmentId)
      if (parentEnv) {
        parentEnv.subEnvironments ??= []
        parentEnv.subEnvironments.push(newEnv)
      }
    } else {
      // Add to folder
      const folder = this.findById(parentId)
      if (folder && isEnvironmentFolder(folder)) {
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
  // Serialization
  // ==========================================================================

  /**
   * Serialize a folder for persistence (respecting @NonSerialised decorators)
   */
  serializeFolder(folder: Folder | EnvironmentFolder): Record<string, unknown> {
    const constructor = isEnvironmentFolder(folder) ? EnvironmentFolder : Folder
    return serializeWithDecorators(constructor, folder.toPlainObject())
  }

  /**
   * Serialize a request for persistence
   */
  serializeRequest(request: Request): Record<string, unknown> {
    const constructor = this.getRequestConstructor(request.type)
    return serializeWithDecorators(constructor, request.toPlainObject())
  }

  /**
   * Serialize an environment for persistence
   */
  serializeEnvironment(environment: Environment): Record<string, unknown> {
    return serializeWithDecorators(Environment, environment.toPlainObject())
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private findInItems(items: FolderItem[], id: string): FolderItem | null {
    for (const item of items) {
      if (item.id === id) return item
      if (isAnyFolder(item)) {
        const found = this.findInItems(item.items, id)
        if (found) return found
      }
    }
    return null
  }

  private findEnvironmentInFolder(folder: Folder | EnvironmentFolder, id: string): Environment | null {
    if (isEnvironmentFolder(folder)) {
      for (const env of folder.environments) {
        if (env.id === id) return env
        const found = this.findInSubEnvironments(env.subEnvironments, id)
        if (found) return found
      }
    }
    for (const item of folder.items) {
      if (isAnyFolder(item)) {
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

  private findParentInFolder(folder: Folder | EnvironmentFolder, itemId: string): Folder | EnvironmentFolder | null {
    for (const item of folder.items) {
      if (item.id === itemId) return folder
      if (isAnyFolder(item)) {
        const found = this.findParentInFolder(item, itemId)
        if (found) return found
      }
    }
    return null
  }

  private deleteEnvironmentFromFolder(folder: Folder | EnvironmentFolder, id: string): boolean {
    if (isEnvironmentFolder(folder)) {
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
      if (isAnyFolder(item)) {
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

  private ensureEnvironmentFolderInstance(obj: unknown): EnvironmentFolder {
    if (obj instanceof EnvironmentFolder) return obj
    return EnvironmentFolder.fromPlain(obj as Parameters<typeof EnvironmentFolder.fromPlain>[0])
  }

  private createRequestInstance(data: Partial<Request> & { type: Request['type'] }): Request {
    switch (data.type) {
      case 'http':
        return HTTPRequest.fromPlain(data as Parameters<typeof HTTPRequest.fromPlain>[0])
      case 'graphql':
        return GraphQLRequest.fromPlain(data as Parameters<typeof GraphQLRequest.fromPlain>[0])
      case 'grpc':
        return GrpcRequest.fromPlain(data as Parameters<typeof GrpcRequest.fromPlain>[0])
      case 'soap':
        return SoapRequest.fromPlain(data as Parameters<typeof SoapRequest.fromPlain>[0])
      case 'websocket':
        return WebSocketRequest.fromPlain(data as Parameters<typeof WebSocketRequest.fromPlain>[0])
      case 'odata':
        return ODataRequest.fromPlain(data as Parameters<typeof ODataRequest.fromPlain>[0])
      case 'auth':
        return AuthenticationRequest.fromPlain(data as Parameters<typeof AuthenticationRequest.fromPlain>[0])
      default:
        // Default to HTTPRequest
        return HTTPRequest.fromPlain(data as Parameters<typeof HTTPRequest.fromPlain>[0])
    }
  }

  private getRequestConstructor(type: Request['type']): new (...args: unknown[]) => Request {
    switch (type) {
      case 'http': return HTTPRequest as new (...args: unknown[]) => Request
      case 'graphql': return GraphQLRequest as new (...args: unknown[]) => Request
      case 'grpc': return GrpcRequest as new (...args: unknown[]) => Request
      case 'soap': return SoapRequest as new (...args: unknown[]) => Request
      case 'websocket': return WebSocketRequest as new (...args: unknown[]) => Request
      case 'odata': return ODataRequest as new (...args: unknown[]) => Request
      case 'auth': return AuthenticationRequest as new (...args: unknown[]) => Request
      default: return HTTPRequest as new (...args: unknown[]) => Request
    }
  }

  // ==========================================================================
  // Event Emission (EventBus + PubSub)
  // ==========================================================================

  private emitFolderCreated(folder: Folder | EnvironmentFolder, parentId: string | null): void {
    const payload: DocumentChangedPayload = {
      id: folder.id,
      type: 'folder',
      document: folder.toPlainObject(),
      parentFolderId: parentId ?? undefined
    }
    void eventBusService.emit(DocumentEvents.FOLDER_CREATED, payload)
    pubsub.publish(PUBSUB_TOPICS.FOLDER_CREATED, folder)
    logger.debug('[CollectionStore] Folder created', { id: folder.id, name: folder.name })
  }

  private emitFolderUpdated(folder: Folder | EnvironmentFolder): void {
    const payload: DocumentChangedPayload = {
      id: folder.id,
      type: 'folder',
      document: folder.toPlainObject()
    }
    void eventBusService.emit(DocumentEvents.FOLDER_UPDATED, payload)
    pubsub.publish(PUBSUB_TOPICS.FOLDER_UPDATED, folder)
    logger.debug('[CollectionStore] Folder updated', { id: folder.id, name: folder.name })
  }

  private emitFolderDeleted(id: string): void {
    const payload: DocumentDeletedPayload = {
      id,
      type: 'folder'
    }
    void eventBusService.emit(DocumentEvents.FOLDER_DELETED, payload)
    pubsub.publish(PUBSUB_TOPICS.FOLDER_DELETED, id)
    logger.debug('[CollectionStore] Folder deleted', { id })
  }

  private emitRequestCreated(request: Request, parentId: string): void {
    const payload: DocumentChangedPayload = {
      id: request.id,
      type: 'request',
      document: request.toPlainObject(),
      parentFolderId: parentId
    }
    void eventBusService.emit(DocumentEvents.REQUEST_CREATED, payload)
    pubsub.publish(PUBSUB_TOPICS.REQUEST_CREATED, request)
    logger.debug('[CollectionStore] Request created', { id: request.id, name: request.name })
  }

  private emitRequestUpdated(request: Request): void {
    // Look up the parent folder so the SearchIndexService can re-key the
    // search document under the same `navigation.folderId` it used at
    // CREATE time. Without this, a nested request edited via the GraphQL
    // mutation path would land in `parentFolderId === undefined`, and
    // the subscriber's fallback (`payload.parentFolderId ?? payload.id`)
    // would point search-result navigation at the request itself.
    // Root-level requests legitimately have no parent — pass undefined.
    const parent = this.findParentFolder(request.id)
    const payload: DocumentChangedPayload = {
      id: request.id,
      type: 'request',
      document: request.toPlainObject(),
      ...(parent ? { parentFolderId: parent.id } : {})
    }
    void eventBusService.emit(DocumentEvents.REQUEST_UPDATED, payload)
    pubsub.publish(PUBSUB_TOPICS.REQUEST_UPDATED, request)
    logger.debug('[CollectionStore] Request updated', { id: request.id, name: request.name })
  }

  private emitRequestDeleted(id: string): void {
    const payload: DocumentDeletedPayload = {
      id,
      type: 'request'
    }
    void eventBusService.emit(DocumentEvents.REQUEST_DELETED, payload)
    pubsub.publish(PUBSUB_TOPICS.REQUEST_DELETED, id)
    logger.debug('[CollectionStore] Request deleted', { id })
  }

  private emitEnvironmentCreated(env: Environment, parentId: string, parentEnvironmentId?: string): void {
    const payload: DocumentChangedPayload = {
      id: env.id,
      type: 'environment',
      document: env.toPlainObject(),
      parentFolderId: parentId,
      parentEnvironmentId
    }
    void eventBusService.emit(DocumentEvents.ENVIRONMENT_CREATED, payload)
    pubsub.publish(PUBSUB_TOPICS.ENVIRONMENT_CREATED, env)
    logger.debug('[CollectionStore] Environment created', { id: env.id, name: env.name })
  }

  private emitEnvironmentUpdated(env: Environment): void {
    const payload: DocumentChangedPayload = {
      id: env.id,
      type: 'environment',
      document: env.toPlainObject()
    }
    void eventBusService.emit(DocumentEvents.ENVIRONMENT_UPDATED, payload)
    pubsub.publish(PUBSUB_TOPICS.ENVIRONMENT_UPDATED, env)
    logger.debug('[CollectionStore] Environment updated', { id: env.id, name: env.name })
  }

  private emitEnvironmentDeleted(id: string): void {
    const payload: DocumentDeletedPayload = {
      id,
      type: 'environment'
    }
    void eventBusService.emit(DocumentEvents.ENVIRONMENT_DELETED, payload)
    pubsub.publish(PUBSUB_TOPICS.ENVIRONMENT_DELETED, id)
    logger.debug('[CollectionStore] Environment deleted', { id })
  }
}

// Singleton instance
export const collectionStore = new CollectionStore()
