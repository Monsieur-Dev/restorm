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
  Scenario,
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
  isScenario,
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
   * Find the EnvironmentFolder owning a given environment (or
   * sub-environment) id. Custom value lists live on that folder, so
   * env-variable resolution needs it to look up a `CustomListValue`
   * label → entry value.
   */
  findEnvironmentFolderByEnvironmentId(envId: string): EnvironmentFolder | null {
    for (const collection of this.collections) {
      if (this.findEnvironmentInFolder(collection, envId)) {
        return collection
      }
    }
    return null
  }

  /**
   * Find parent folder of an item
   */
  findParentFolder(itemId: string): Folder | EnvironmentFolder | Scenario | null {
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
   * Re-emit `ENVIRONMENT_CREATED` for every loaded environment so listeners
   * (notably ContextService, which resolves `{{var}}` per environment) rebuild
   * their context. The interactive flow gets these from the renderer's
   * per-document load events; a headless load (`loadProjectIntoStore`, no
   * renderer) has none, so it calls this right after `setCollections`. Parent
   * environments are emitted before their `subEnvironments` so inheritance
   * resolves in order.
   */
  reemitAllEnvironmentsCreated(): void {
    const walkEnv = (env: Environment, folderId: string, parentEnvId?: string): void => {
      this.emitEnvironmentCreated(env, folderId, parentEnvId)
      for (const sub of env.subEnvironments ?? []) walkEnv(sub, folderId, env.id)
    }
    const walkFolder = (item: FolderItem): void => {
      if (isEnvironmentFolder(item)) {
        for (const env of item.environments) walkEnv(env, item.id)
      }
      if (isAnyFolder(item)) {
        for (const child of item.items) walkFolder(child)
      }
    }
    for (const c of this.collections) walkFolder(c)
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
        notes: newFolder.notes,
        tags: newFolder.tags,
        items: [],
        environments: []
      })
      this.collections.push(envFolder)
      this.emitFolderCreated(envFolder, parentId)
      return envFolder
    }

    // Add to parent folder (a scenario is a folder-like container too)
    const parent = this.findById(parentId)
    if (parent && this.isContainer(parent)) {
      this.childItemsForWrite(parent).push(newFolder)
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

    // Detect whether the patch touches `environments` on an env-folder
    // BEFORE we apply it — we need the post-apply env list to fire
    // per-env `ENVIRONMENT_UPDATED` events so `ContextService`
    // recalculates its handlebars context (env-folder save units don't
    // travel through the env event bus on their own).
    const patchTouchesEnvironments = isEnvironmentFolder(folder)
      && Object.prototype.hasOwnProperty.call(updates as Record<string, unknown>, 'environments')

    // Apply updates
    Object.assign(folder, updates)

    // Emit event
    this.emitFolderUpdated(folder)

    // When `environments` was in the patch, the renderer's env-context
    // store needs a per-env `ENVIRONMENT_UPDATED` so it re-resolves
    // variables (e.g. a new `JWTBearer_token` secret has to land in
    // the handlebars context, otherwise templated headers like
    // `Bearer {{JWTBearer_token}}` keep resolving to an empty string
    // and downstream requests 403). Walks `subEnvironments` so a
    // nested env update also propagates.
    if (patchTouchesEnvironments && isEnvironmentFolder(folder)) {
      const emitTree = (env: Environment): void => {
        this.emitEnvironmentUpdated(env)
        for (const sub of env.subEnvironments ?? []) emitTree(sub)
      }
      for (const env of folder.environments) emitTree(env)
    }
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

    const siblings = this.childItems(parent)
    const index = siblings.findIndex(item => item.id === id)
    if (index !== -1) {
      siblings.splice(index, 1)
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
      const currentSiblings = this.childItems(currentParent)
      const currentIndex = currentSiblings.findIndex(item => item.id === id)
      if (currentIndex !== -1) {
        currentSiblings.splice(currentIndex, 1)
      }
    } else {
      // It's a root collection
      const rootIndex = this.collections.findIndex(c => c.id === id)
      if (rootIndex !== -1) {
        this.collections.splice(rootIndex, 1)
      }
    }

    // Add to new parent (a scenario is a folder-like container too)
    const newParent = this.findById(newParentId)
    if (newParent && this.isContainer(newParent)) {
      this.childItemsForWrite(newParent).splice(index, 0, folder)
    }

    // Emit event
    this.emitFolderUpdated(folder)
    return folder
  }

  /**
   * Delete a scenario by id. A scenario is a folder-like tree item, so this
   * mirrors {@link deleteFolder}: remove it from its parent container (folder,
   * env-folder, scenario, or the root) and emit a folder-deleted event so the
   * sidebar drops it. Cascades to the scenario's child items implicitly (they
   * leave the tree with it).
   */
  deleteScenario(id: string): boolean {
    const parent = this.findParentFolder(id)
    if (!parent) {
      const index = this.collections.findIndex(c => c.id === id)
      if (index !== -1) {
        this.collections.splice(index, 1)
        this.emitFolderDeleted(id)
        return true
      }
      return false
    }
    const siblings = this.childItems(parent)
    const index = siblings.findIndex(item => item.id === id)
    if (index !== -1) {
      siblings.splice(index, 1)
      this.emitFolderDeleted(id)
      return true
    }
    return false
  }

  /**
   * Update a scenario's tree-level metadata (name / notes / tags). A scenario
   * is a folder-like item, so this mirrors {@link updateFolder} and emits a
   * folder-updated event so the sidebar relabels. Graph mutations (nodes /
   * edges / config / params) go through the scenario authoring tools + the
   * editor, never here.
   */
  updateScenario(id: string, updates: Partial<Scenario>): Scenario | null {
    const scenario = this.findById(id)
    if (!scenario || !isScenario(scenario)) return null
    Object.assign(scenario, updates)
    this.emitFolderUpdated(scenario)
    return scenario
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
    if (parent && this.isContainer(parent)) {
      this.childItemsForWrite(parent).push(newRequest)
    }

    // Emit event
    this.emitRequestCreated(newRequest, parentId)
    return newRequest
  }

  /**
   * Create a new scenario as a child of `parentId` (a folder-like container).
   * Returns the inserted Scenario.
   */
  createScenario(parentId: string, scenarioData: Partial<Scenario> & { name: string }): Scenario {
    const newScenario = new Scenario({
      ...scenarioData,
      id: scenarioData.id ?? this.generateId(),
      name: scenarioData.name,
      tags: scenarioData.tags ?? [],
      params: scenarioData.params ?? [],
      nodes: scenarioData.nodes ?? [],
      edges: scenarioData.edges ?? [],
      items: scenarioData.items ?? []
    })
    const parent = this.findById(parentId)
    if (parent && this.isContainer(parent)) {
      this.childItemsForWrite(parent).push(newScenario)
    }
    logger.debug('[CollectionStore] Scenario created', { id: newScenario.id, name: newScenario.name, parentId })
    return newScenario
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

    const siblings = this.childItems(parent)
    const index = siblings.findIndex(item => item.id === id)
    if (index !== -1) {
      siblings.splice(index, 1)
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
      const currentSiblings = this.childItems(currentParent)
      const currentIndex = currentSiblings.findIndex(item => item.id === id)
      if (currentIndex !== -1) {
        currentSiblings.splice(currentIndex, 1)
      }
    }

    // Add to new parent (a scenario is a folder-like container too)
    const newParent = this.findById(newParentId)
    if (newParent && this.isContainer(newParent)) {
      this.childItemsForWrite(newParent).splice(index, 0, request)
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

  /** A folder-like container: a folder, env-folder, OR a scenario (which holds
   * child items just like a folder). */
  private isContainer(item: FolderItem): item is Folder | EnvironmentFolder | Scenario {
    return isAnyFolder(item) || isScenario(item)
  }

  /** Live child-items array of a container (a scenario's `items` is optional —
   * read as empty when absent). */
  private childItems(item: Folder | EnvironmentFolder | Scenario): FolderItem[] {
    if (isScenario(item)) return item.items ?? []
    return item.items
  }

  /** Live child-items array of a container, initialising a scenario's `items`
   * to `[]` when absent so callers can push into it. */
  private childItemsForWrite(item: Folder | EnvironmentFolder | Scenario): FolderItem[] {
    if (isScenario(item)) return (item.items ??= [])
    return item.items
  }

  private findInItems(items: FolderItem[], id: string): FolderItem | null {
    for (const item of items) {
      if (item.id === id) return item
      if (this.isContainer(item)) {
        const found = this.findInItems(this.childItems(item), id)
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

  private findParentInFolder(folder: Folder | EnvironmentFolder | Scenario, itemId: string): Folder | EnvironmentFolder | Scenario | null {
    for (const item of this.childItems(folder)) {
      if (item.id === itemId) return folder
      if (this.isContainer(item)) {
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
    const folder = obj instanceof EnvironmentFolder
      ? obj
      : EnvironmentFolder.fromPlain(obj as Parameters<typeof EnvironmentFolder.fromPlain>[0])
    // Children come back as plain objects from the IPC roundtrip
    // (renderer's `setCollections` mirrors via JSON.stringify). Walk
    // nested items so the in-memory store always exposes class
    // instances — `toPlainObject()` / decorator serializers fail
    // silently otherwise and the next mutation throws.
    folder.items = folder.items.map((it: FolderItem) => this.reifyItem(it))
    return folder
  }

  private reifyItem(item: FolderItem): FolderItem {
    if (typeof item !== 'object') return item
    if (item instanceof EnvironmentFolder || item instanceof Folder) {
      item.items = item.items.map((c: FolderItem) => this.reifyItem(c))
      return item
    }
    if (item instanceof Scenario) {
      // A scenario is a folder-like container: reify its children too so the
      // store exposes class instances (and the MCP can mutate its contents).
      if (item.items) item.items = item.items.map((c) => this.reifyItem(c))
      return item
    }
    const rec = item as unknown as Record<string, unknown>
    // Scenario leaf (plain object). Checked before the generic
    // `type`-bearing request branch — a scenario also carries a `type`,
    // and the request factory would otherwise mis-build it as an
    // HTTPRequest, dropping its nodes/edges.
    if (rec['type'] === 'scenario') {
      const scenario = Scenario.fromPlain(rec as Parameters<typeof Scenario.fromPlain>[0])
      // Carry + reify the scenario's child items (it behaves like a folder).
      if (Array.isArray(rec['items'])) {
        scenario.items = (rec['items'] as FolderItem[]).map((c) => this.reifyItem(c))
      }
      return scenario
    }
    if (Array.isArray(rec['items'])) {
      // Nested folder (plain object). EnvironmentFolders only ever sit
      // at the root, so a nested `items` carrier is a plain Folder.
      // No `fromPlain` on Folder — instantiate directly + carry over
      // the fields we care about, then recurse.
      const reified = new Folder({
        id: typeof rec['id'] === 'string' ? rec['id'] : crypto.randomUUID(),
        name: typeof rec['name'] === 'string' ? rec['name'] : '',
        items: []
      })
      reified.items = (rec['items'] as FolderItem[]).map((c) => this.reifyItem(c))
      return reified
    }
    if (typeof rec['type'] === 'string') {
      // Request leaf. Reuse the same factory the create path uses.
      return this.createRequestInstance(rec as Partial<Request> & { type: Request['type'] })
    }
    return item
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

  private emitFolderUpdated(folder: Folder | EnvironmentFolder | Scenario): void {
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
      // Pass the live `Environment` (with real `KeyValue` instances)
      // instead of `toPlainObject()` — the latter calls
      // `serializeValueForPersistence` which strips `PasswordValue`
      // plaintext. This emit is main-process-internal (handlers run
      // in-process, no IPC structured clone), so the consumers
      // (ContextService) see the secret-bearing instance and can
      // resolve `{{token}}` correctly.
      document: env,
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
      // See `emitEnvironmentCreated` — pass the live instance so
      // `PasswordValue` plaintext survives the eventBus hop.
      document: env
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
