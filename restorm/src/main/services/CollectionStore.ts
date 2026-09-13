/**
 * Collection Store - Main process store for Restorm collections
 *
 * Manages the in-memory representation of collections, folders, requests, and environments.
 * Uses decorated model classes and publishes events via GraphQL PubSub.
 */

import { eventBusService, logger, createPubSub, serializeWithDecorators } from 'electron-core-ui/main'
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload } from './DocumentEvents'
import { sanitizeUpdatePatch } from './sanitizeUpdatePatch'
import {
  Folder,
  EnvironmentFolder,
  Scenario,
  ApiDesign,
  RecordingSession,
  Environment,
  KeyValue,
  isEnvironmentFolder,
  isAnyFolder,
  isScenario,
  isApiDesign,
  isRecordingSession,
  type FolderItem,
  type Request
} from '../../shared/models'
import { createRequestFromPlain, getRequestConstructor as resolveRequestConstructor } from '../../shared/models/requests/requestFactory'

/** Every tree item that holds child items. */
type Container = Folder | EnvironmentFolder | Scenario | RecordingSession
/** Item kinds `moveItem` reports back. */
type MovedKind = 'request' | 'folder' | 'env-folder' | 'scenario' | 'design' | 'recording'

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
// Store Class
// ============================================================================

/**
 * Collection Store - Manages collections in the main process
 */
class CollectionStore {
  /**
   * The ROOT of the tree. Usually collections (env-folders), but the root is
   * not restricted to them: the sidebar lets a scenario or a request sit there
   * as a sibling of a collection, so this is a `FolderItem[]` — NOT an
   * `EnvironmentFolder[]`. Declaring it as the latter is what licensed
   * {@link setCollections} to coerce every root entry into an
   * `EnvironmentFolder`, which kept the item's `id` but dropped what it WAS.
   */
  private collections: FolderItem[] = []
  /** Listeners fired after the whole collection tree is (re)set — e.g. on load.
   * Lets higher layers (ContextService) react without CollectionStore importing
   * them (no downward dependency). */
  private collectionsSetListeners: (() => void)[] = []

  /**
   * Monotonic version of the main-side tree, bumped once per main-driven
   * mutation (every MCP write funnels through `broadcastTreeReplace`, which
   * calls {@link bumpModelVersion}). It exists to break the write race between
   * an MCP mutation and the renderer's autosave mirror: the renderer stamps
   * each `collections:sync` with the last MCP version it has APPLIED, and
   * {@link setCollections} refuses a `'user'` mirror whose stamp is older than
   * this counter — that mirror is echoing a tree that predates a mutation the
   * renderer hasn't rendered yet, so accepting it would silently drop the
   * mutation. Never reset (session-global); the renderer's counter is equally
   * monotonic so the comparison stays meaningful across project loads.
   */
  private modelVersion = 0

  /** Register a callback fired after every `setCollections` (load / replace). */
  onCollectionsSet(cb: () => void): void {
    this.collectionsSetListeners.push(cb)
  }

  /** Current main-side tree version (see {@link modelVersion}). */
  getModelVersion(): number {
    return this.modelVersion
  }

  /**
   * Increment and return the tree version so a subsequent stale renderer mirror
   * can be recognised and refused. `broadcastTreeReplace` calls it for
   * folder/request writes. Scenario node/edge edits mutate the live scenario
   * object directly (never through a CollectionStore method) and — critically —
   * that in-place mutation can yield to the event loop before the broadcast
   * runs, so the scenario tools call this the INSTANT they touch the graph
   * (`markScenarioMutated`), not only later on the broadcast: otherwise the
   * renderer's in-flight autosave mirror of the pre-mutation tree, stamped the
   * SAME version, lands in that window and — since {@link setCollections} only
   * refuses a strictly-older stamp — overwrites the freshly-created node. A
   * second monotonic bump on the broadcast is harmless.
   */
  bumpModelVersion(): number {
    this.modelVersion += 1
    return this.modelVersion
  }

  // ==========================================================================
  // Getters
  // ==========================================================================

  /**
   * Get the root items of the tree — collections, plus any scenario or
   * request the user placed at the root.
   */
  getCollections(): FolderItem[] {
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
      // A root entry may be a scenario or a request; only folders hold
      // environments.
      if (!isAnyFolder(collection)) continue
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
      if (!isEnvironmentFolder(collection)) continue
      if (this.findEnvironmentInFolder(collection, envId)) {
        return collection
      }
    }
    return null
  }

  /**
   * Find parent folder of an item
   */
  findParentFolder(itemId: string): Container | null {
    for (const collection of this.collections) {
      // A root request has no children to descend into.
      if (!this.isContainer(collection)) continue
      const parent = this.findParentInFolder(collection, itemId)
      if (parent) return parent
    }
    return null
  }

  // ==========================================================================
  // Setters
  // ==========================================================================

  /**
   * Set all collections (used when loading from file, or mirrored from the
   * renderer via `collections:sync`).
   *
   * `clientVersion` is the model version the caller is echoing (see
   * {@link modelVersion}). For a `'user'` mirror it guards the MCP-write race:
   * if the renderer's stamp is OLDER than the current version, the mirror is
   * refused (returns `false`) and the authoritative tree is kept — the mirror
   * was built from a tree that predates an MCP mutation the renderer hasn't
   * applied yet, so writing it would drop that mutation. A `'file-load'` (or a
   * trusted main-side call with no `clientVersion`) always applies. Returns
   * whether the tree was actually replaced.
   */
  setCollections(collections: FolderItem[], source: 'file-load' | 'user' = 'file-load', clientVersion?: number): boolean {
    if (source === 'user' && clientVersion !== undefined && clientVersion < this.modelVersion) {
      logger.warn('[CollectionStore] Refused stale renderer mirror', {
        clientVersion,
        modelVersion: this.modelVersion,
        count: collections.length
      })
      return false
    }
    // Convert plain objects to class instances if needed
    this.collections = collections.map(c => this.reifyRootItem(c))
    logger.info('[CollectionStore] Collections set', { count: collections.length, source })
    for (const cb of this.collectionsSetListeners) cb()
    return true
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
  /**
   * Create a folder. At the root (`parentId === null`) both root folder kinds
   * are reachable: `kind: 'env-folder'` (the default — a collection, which is
   * what the root usually holds) or `kind: 'folder'` for a plain folder
   * sitting beside the collections, which the sidebar's empty-area "Add"
   * submenu also offers. Nested folders are always plain folders: an
   * environment folder only exists at the root.
   */
  createFolder(
    parentId: string | null,
    folderData: Partial<Folder> & { name: string },
    kind: 'folder' | 'env-folder' = 'env-folder'
  ): Folder {
    const newFolder = new Folder({
      ...folderData,
      id: folderData.id ?? this.generateId(),
      name: folderData.name,
      items: folderData.items ?? []
    })

    if (parentId === null) {
      if (kind === 'folder') {
        this.collections.push(newFolder)
        this.emitFolderCreated(newFolder, parentId)
        return newFolder
      }
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

    // Apply updates — never let a patch re-key the node (`id`) or
    // replace its children (`items`).
    Object.assign(folder, sanitizeUpdatePatch(updates, ['items']))

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
    Object.assign(scenario, sanitizeUpdatePatch(updates, ['items']))
    this.emitFolderUpdated(scenario)
    return scenario
  }

  // ==========================================================================
  // Mutations - recording sessions
  // ==========================================================================

  /**
   * Create a recording session under `parentId` (any container) or at the
   * ROOT when `null`. Emits the recording-typed created event so search
   * indexes it and the save-unit bridge learns about the new document.
   */
  createRecording(parentId: string | null, data: Partial<RecordingSession> & { name: string }): RecordingSession {
    const session = RecordingSession.fromPlain({
      ...data,
      id: data.id ?? this.generateId(),
      name: data.name
    })
    if (parentId === null) {
      this.collections.push(session)
    } else {
      const parent = this.findById(parentId)
      if (parent && this.isContainer(parent)) {
        this.childItemsForWrite(parent).push(session)
      }
    }
    this.emitRecordingCreated(session, parentId)
    logger.debug('[CollectionStore] Recording session created', { id: session.id, name: session.name, parentId })
    return session
  }

  /**
   * Patch a recording session's own fields (name / notes / url / protocols /
   * lists) in place — never its `items`, which the deduction owns — and emit
   * the recording-typed updated event.
   */
  updateRecording(id: string, updates: Partial<RecordingSession>): RecordingSession | null {
    const session = this.findById(id)
    if (!session || !isRecordingSession(session)) return null
    Object.assign(session, sanitizeUpdatePatch(updates, ['items']))
    this.emitRecordingUpdated(session)
    return session
  }

  /**
   * Emit RECORDING_UPDATED for a session a caller mutated in place while
   * holding the store's object (the MCP deduction replaces `items`).
   */
  notifyRecordingUpdated(session: RecordingSession): void {
    this.emitRecordingUpdated(session)
  }

  /** Delete a recording session by id (root or nested). Emits the
   * recording-typed deleted event — the capture engine / store listen to it
   * to drop the live recording and its captures. */
  deleteRecording(id: string): boolean {
    const session = this.findById(id)
    if (!session || !isRecordingSession(session)) return false
    const parent = this.findParentFolder(id)
    if (!parent) {
      const index = this.collections.findIndex((c) => c.id === id)
      if (index === -1) return false
      this.collections.splice(index, 1)
    } else {
      const siblings = this.childItemsForWrite(parent)
      const index = siblings.findIndex((item) => item.id === id)
      if (index === -1) return false
      siblings.splice(index, 1)
    }
    this.emitRecordingDeleted(id)
    logger.debug('[CollectionStore] Recording session deleted', { id })
    return true
  }

  // ==========================================================================
  // Mutations - API designs
  // ==========================================================================

  private designIngestionStarted = false

  /**
   * Ingest RENDERER-side design edits into main's copy. Unlike request
   * row edits (deliberately unmirrored — the whole-tree replace hazard),
   * a design edit already crosses to main as a DESIGN_UPDATED event
   * carrying the full document; folding it into main's tree keeps this
   * copy current, so an MCP design write starts from the renderer's
   * latest state instead of clobbering an unsaved edit on the next
   * tree broadcast. Idempotent for main's own emissions (re-assigning
   * an identical document is a no-op in effect).
   */
  startDesignIngestion(): void {
    if (this.designIngestionStarted) return
    this.designIngestionStarted = true
    eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.DESIGN_UPDATED, (payload) => {
      const doc = payload.document
      if (doc === undefined || (doc as { type?: unknown }).type !== 'design') return
      const existing = this.findById(payload.id)
      if (!existing || !isApiDesign(existing)) return
      const fresh = ApiDesign.fromPlain(doc as Record<string, unknown>)
      // `fromPlain` sets the optional slots by CONDITIONAL spread, so a
      // key the renderer removed is absent from `fresh` and a bare
      // `Object.assign` would keep the stale value alive (and the next
      // tree-replace would resurrect it renderer-side). Reconcile the
      // known optional slots first, then merge into the SAME object so
      // references held by parents stay.
      if (!('notes' in fresh)) delete existing.notes
      if (!('server' in fresh)) delete existing.server
      if (!('securitySchemes' in fresh)) delete existing.securitySchemes
      if (!('defaultSecurity' in fresh)) delete existing.defaultSecurity
      if (!('defaultAuth' in fresh)) delete existing.defaultAuth
      if (!('serving' in fresh)) delete existing.serving
      if (!('codegen' in fresh)) delete existing.codegen
      Object.assign(existing, fresh)
    })
  }

  /**
   * Create a new API design under `parentId` (any container) or at the
   * ROOT when `null` — the same placements the sidebar offers. Emits a
   * design-typed created event so search indexes it and the renderer's
   * upsert re-instantiates it with the right class.
   */
  createDesign(parentId: string | null, designData: Partial<ApiDesign> & { name: string }): ApiDesign {
    const newDesign = ApiDesign.fromPlain({
      ...designData,
      id: designData.id ?? this.generateId(),
      name: designData.name
    })
    if (parentId === null) {
      this.collections.push(newDesign)
    } else {
      const parent = this.findById(parentId)
      if (parent && this.isContainer(parent)) {
        this.childItemsForWrite(parent).push(newDesign)
      }
    }
    this.emitDesignCreated(newDesign, parentId)
    logger.debug('[CollectionStore] Design created', { id: newDesign.id, name: newDesign.name, parentId })
    return newDesign
  }

  /**
   * Update a design in place and emit the design-typed updated event
   * (NEVER a request-typed one — the renderer would cleanse the draft
   * against the HTTP-request shape and drop every design section).
   * Sections mutate by REASSIGNMENT (`design.models = [...]`), same
   * convention as the renderer's `assignDesignSection`.
   */
  updateDesign(id: string, updates: Partial<ApiDesign>): ApiDesign | null {
    const design = this.findById(id)
    if (!design || !isApiDesign(design)) return null
    Object.assign(design, sanitizeUpdatePatch(updates, []))
    this.emitDesignUpdated(design)
    return design
  }

  /**
   * Emit DESIGN_UPDATED for a design whose sections were mutated in
   * place by a caller holding the store's object (the MCP design tools
   * work this way). Without it the search index and the renderer's
   * save-unit bridge never learn about the edit.
   */
  notifyDesignUpdated(design: ApiDesign): void {
    this.emitDesignUpdated(design)
  }

  /** Delete a design by id (root or nested). Emits the design-typed
   * deleted event so the search sub-documents sweep. */
  deleteDesign(id: string): boolean {
    const design = this.findById(id)
    if (!design || !isApiDesign(design)) return false
    const parent = this.findParentFolder(id)
    if (!parent) {
      const index = this.collections.findIndex((c) => c.id === id)
      if (index === -1) return false
      this.collections.splice(index, 1)
    } else {
      const siblings = this.childItemsForWrite(parent)
      const index = siblings.findIndex((item) => item.id === id)
      if (index === -1) return false
      siblings.splice(index, 1)
    }
    this.emitDesignDeleted(id)
    return true
  }

  // ==========================================================================
  // Mutations - Requests
  // ==========================================================================

  /**
   * Create a new request under `parentId`, or at the ROOT of the tree when it
   * is `null` — the root accepts a request beside a collection.
   */
  createRequest(parentId: string | null, requestData: Partial<Request> & { type: Request['type']; name: string }): Request {
    const newRequest = this.createRequestInstance(requestData)
    newRequest.id = requestData.id ?? this.generateId()

    if (parentId === null) {
      // A request may live at the ROOT, beside a collection — the sidebar
      // offers it, so the programmatic paths must too.
      this.collections.push(newRequest)
    } else {
      const parent = this.findById(parentId)
      if (parent && this.isContainer(parent)) {
        this.childItemsForWrite(parent).push(newRequest)
      }
    }

    // Emit event
    this.emitRequestCreated(newRequest, parentId)
    return newRequest
  }

  /**
   * Create a new scenario as a child of `parentId` (a folder-like container),
   * or at the ROOT of the tree when `parentId` is `null` — the placement the
   * sidebar's empty-area "add" menu offers. Returns the inserted Scenario.
   */
  createScenario(parentId: string | null, scenarioData: Partial<Scenario> & { name: string }): Scenario {
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
    if (parentId === null) {
      // A scenario may live at the ROOT, beside a collection — the sidebar's
      // empty-area "add" menu creates one there, so the programmatic paths
      // must be able to express the same placement.
      this.collections.push(newScenario)
    } else {
      const parent = this.findById(parentId)
      if (parent && this.isContainer(parent)) {
        this.childItemsForWrite(parent).push(newScenario)
      }
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

    // Apply updates — never let a patch re-key the request (`id`).
    Object.assign(request, sanitizeUpdatePatch(updates))

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

  /**
   * Move a tree item (request / folder / env-folder / scenario) to a new parent
   * and/or position, with full validation. Unlike {@link moveFolder} /
   * {@link moveRequest} — which remove-then-add and would ORPHAN the item if the
   * target turns out invalid — this validates everything BEFORE mutating, so a
   * rejected move never loses the item.
   *
   * @param newParentId Destination container id. `undefined` keeps the current
   *   parent (reorder-only).
   * @param index 0-based slot among the destination's children, interpreted
   *   AFTER the item leaves its current spot (so moving an item earlier shifts
   *   the items at/after that slot one position later). `undefined` appends.
   *
   * Rules enforced:
   *  - the destination must be a container (a request cannot be a parent);
   *  - an item cannot move into itself or its own descendant (cycle);
   *  - an env-folder may not have an env-folder OR a scenario as any ancestor
   *    (at any depth) — it can otherwise live anywhere (incl. a plain folder).
   */
  moveItem(
    id: string,
    newParentId: string | undefined,
    index: number | undefined
  ): { ok: true; kind: MovedKind; parentId: string | null; index: number } | { ok: false; error: string } {
    const item = this.findById(id)
    if (!item) return { ok: false, error: `No item with id ${id}` }

    // A design must NOT fall through to 'request': emitting it with a
    // request-typed update would make the renderer cleanse the draft
    // against the HTTP-request shape and drop every design section.
    const kind: MovedKind =
      isScenario(item) ? 'scenario'
        : isApiDesign(item) ? 'design'
          : isRecordingSession(item) ? 'recording'
            : isEnvironmentFolder(item) ? 'env-folder' : isAnyFolder(item) ? 'folder' : 'request'
    const explicitParent = newParentId !== undefined && newParentId.length > 0
    const currentParent = this.findParentFolder(id)
    const isRootItem = currentParent === null && this.collections.some((c) => c.id === id)

    // Reorder among the ROOT collections: the item is already a root item and no
    // new parent was given (a pure position change at the top level). The
    // container `move*` helpers can't target root, so splice `this.collections`
    // directly. The env-folder rule is moot here — root has no ancestor.
    if (!explicitParent && isRootItem) {
      const cur = this.collections.findIndex((c) => c.id === id)
      const [removed] = this.collections.splice(cur, 1)
      const target = index === undefined
        ? this.collections.length
        : Math.max(0, Math.min(index, this.collections.length))
      this.collections.splice(target, 0, removed)
      if (kind === 'request') this.emitRequestUpdated(removed as unknown as Request)
      else if (kind === 'design') this.emitDesignUpdated(removed as unknown as ApiDesign)
      else if (kind === 'recording') this.emitRecordingUpdated(removed as unknown as RecordingSession)
      else this.emitFolderUpdated(removed as Folder | EnvironmentFolder)
      return { ok: true, kind, parentId: null, index: target }
    }

    const destId = explicitParent ? newParentId : currentParent?.id
    if (destId === undefined) return { ok: false, error: `${id} is a root item; pass newParentId to move it into a container` }
    const dest = this.findById(destId)
    if (!dest) return { ok: false, error: `No item with id ${destId}` }
    if (!this.isContainer(dest)) return { ok: false, error: `${destId} is not a container (folder, env-folder, scenario or recording session)` }

    // Cycle guard: the destination must not be the item itself, nor any of its
    // descendants (walk the destination's ancestor chain looking for `id`).
    for (let p: Container | null = dest; p !== null; p = this.findParentFolder(p.id)) {
      if (p.id === id) return { ok: false, error: 'cannot move an item into itself or its own descendant' }
    }

    // env-folder placement rule: no env-folder or scenario anywhere up the chain.
    if (kind === 'env-folder') {
      for (let p: Container | null = dest; p !== null; p = this.findParentFolder(p.id)) {
        if (isEnvironmentFolder(p)) return { ok: false, error: 'an env-folder cannot be nested inside another env-folder' }
        if (isScenario(p)) return { ok: false, error: 'an env-folder cannot be placed inside a scenario' }
      }
    }

    // Resolve the final index against the post-removal child count of the dest.
    const sameParent = currentParent?.id === destId
    const childCountAfterRemoval = this.childItems(dest).length - (sameParent ? 1 : 0)
    const targetIndex = index === undefined
      ? childCountAfterRemoval
      : Math.max(0, Math.min(index, childCountAfterRemoval))

    // All validation passed — perform the move by splicing directly rather than
    // delegating to moveRequest/moveFolder. moveFolder gates on isAnyFolder,
    // which a Scenario FAILS (it has no `configuration` field), so delegating
    // would silently drop a scenario item. Splicing handles every kind
    // uniformly, and the checks above already guarantee a safe destination.
    if (currentParent) {
      const siblings = this.childItemsForWrite(currentParent)
      const cur = siblings.findIndex((x) => x.id === id)
      if (cur !== -1) siblings.splice(cur, 1)
    } else {
      const cur = this.collections.findIndex((c) => c.id === id)
      if (cur !== -1) this.collections.splice(cur, 1)
    }
    this.childItemsForWrite(dest).splice(targetIndex, 0, item)
    if (kind === 'request') this.emitRequestUpdated(item as Request)
    else if (kind === 'design') this.emitDesignUpdated(item as ApiDesign)
    else this.emitFolderUpdated(item as Folder | EnvironmentFolder)
    return { ok: true, kind, parentId: destId, index: targetIndex }
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

    // Apply updates — never let a patch re-key the environment (`id`).
    Object.assign(env, sanitizeUpdatePatch(updates))

    // Emit event
    this.emitEnvironmentUpdated(env)
    return env
  }

  /**
   * Delete an environment
   */
  deleteEnvironment(id: string): boolean {
    for (const collection of this.collections) {
      if (!isAnyFolder(collection)) continue
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

  /** A folder-like container: a folder, env-folder, a scenario, OR a
   * recording session (both hold child items just like a folder — a
   * recording's `items` are its deduced routes). */
  private isContainer(item: FolderItem): item is Container {
    return isAnyFolder(item) || isScenario(item) || isRecordingSession(item)
  }

  /** Live child-items array of a container (a scenario's / recording's
   * `items` is optional — read as empty when absent). */
  private childItems(item: Container): FolderItem[] {
    // Container children are declared with the base item shape; the store
    // reifies them into model instances, so read them as such.
    if (isScenario(item) || isRecordingSession(item)) return (item.items ?? []) as unknown as FolderItem[]
    return item.items as unknown as FolderItem[]
  }

  /** Live child-items array of a container, initialising a scenario's /
   * recording's `items` to `[]` when absent so callers can push into it. */
  private childItemsForWrite(item: Container): FolderItem[] {
    if (isScenario(item) || isRecordingSession(item)) return (item.items ??= []) as unknown as FolderItem[]
    return item.items as unknown as FolderItem[]
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

  private findParentInFolder(folder: Container, itemId: string): Container | null {
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

  /**
   * Reify ONE root entry. The root of the sidebar is not collections-only: a
   * scenario or a request may sit there as a sibling of a collection, so each
   * entry is reified by its own kind — exactly like a nested child — and only
   * a genuine collection goes through {@link ensureEnvironmentFolderInstance}.
   *
   * Passing every root entry through `EnvironmentFolder.fromPlain` instead
   * rewrote a root scenario into an env-folder. `fromPlain` carries the `id`
   * over, so the item stayed findable — but it lost `type: 'scenario'` along
   * with its nodes/edges/params, and every `isScenario` check downstream then
   * rejected it. The scenario engine reports that as "no scenario with id",
   * which reads like an absence and is not one. A root request was mangled the
   * same way (into an empty env-folder), silently, because the renderer runs
   * requests from its own store and never asks this one to resolve them.
   *
   * A plain folder is a root kind of its own and stays one. `folderType`
   * is the discriminator every `isEnvironmentFolder` check already relies
   * on, so a folder without it is a plain folder — normalising it into an
   * env-folder here would have to be justified by something, and nothing
   * downstream would recognise the result as a collection anyway.
   */
  private reifyRootItem(item: FolderItem): FolderItem {
    if (typeof item !== 'object') return item
    if (isEnvironmentFolder(item)) return this.ensureEnvironmentFolderInstance(item)
    return this.reifyItem(item)
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
    if (item instanceof ApiDesign) return item
    if (item instanceof RecordingSession) {
      // A recording session is a container too: its deduced routes are
      // ordinary items that must come back as class instances.
      if (item.items) item.items = item.items.map((c) => this.reifyItem(c))
      return item
    }
    const rec = item as unknown as Record<string, unknown>
    // Design leaf (plain object). Same reason as the scenario branch
    // below: it carries a `type` the request factory would mangle.
    if (rec['type'] === 'design') {
      return ApiDesign.fromPlain(rec as Parameters<typeof ApiDesign.fromPlain>[0])
    }
    // Recording session (plain object): `type`-bearing like a scenario, with
    // its deduced routes under `items` — reify them like scenario children.
    if (rec['type'] === 'recording') {
      const session = RecordingSession.fromPlain(rec as Parameters<typeof RecordingSession.fromPlain>[0])
      if (Array.isArray(rec['items'])) {
        session.items = (rec['items'] as FolderItem[]).map((c) => this.reifyItem(c))
      }
      return session
    }
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
      // Plain folder (plain object) — nested, or sitting at the root as a
      // sibling of a collection. An env-folder never reaches here: callers
      // route it to `ensureEnvironmentFolderInstance` on its `folderType`.
      //
      // No `fromPlain` on Folder — instantiate directly. Spread EVERY field
      // rather than picking `id`/`name`: a folder also carries
      // `configuration`, `notes` and `icon`, and picking dropped them on
      // each mirror round-trip.
      const reified = new Folder({
        ...(rec as Partial<Folder>),
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
    return createRequestFromPlain(data)
  }

  private getRequestConstructor(type: Request['type']): new (...args: unknown[]) => Request {
    return resolveRequestConstructor(type)
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

  private emitRequestCreated(request: Request, parentId: string | null): void {
    const payload: DocumentChangedPayload = {
      id: request.id,
      type: 'request',
      document: request.toPlainObject(),
      // A root-level request has no parent folder — same convention as
      // `emitRequestUpdated`, which already omits the key at the root.
      ...(parentId !== null ? { parentFolderId: parentId } : {})
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

  private emitRecordingCreated(session: RecordingSession, parentId: string | null): void {
    const payload: DocumentChangedPayload = {
      id: session.id,
      type: 'recording',
      document: session.toPlainObject(),
      ...(parentId !== null ? { parentFolderId: parentId } : {})
    }
    void eventBusService.emit(DocumentEvents.RECORDING_CREATED, payload)
  }

  private emitRecordingUpdated(session: RecordingSession): void {
    const parent = this.findParentFolder(session.id)
    const payload: DocumentChangedPayload = {
      id: session.id,
      type: 'recording',
      document: session.toPlainObject(),
      ...(parent ? { parentFolderId: parent.id } : {})
    }
    void eventBusService.emit(DocumentEvents.RECORDING_UPDATED, payload)
  }

  private emitRecordingDeleted(id: string): void {
    const payload: DocumentDeletedPayload = { id, type: 'recording' }
    void eventBusService.emit(DocumentEvents.RECORDING_DELETED, payload)
  }

  private emitDesignCreated(design: ApiDesign, parentId: string | null): void {
    const payload: DocumentChangedPayload = {
      id: design.id,
      type: 'design',
      document: design.toPlainObject(),
      ...(parentId !== null ? { parentFolderId: parentId } : {})
    }
    void eventBusService.emit(DocumentEvents.DESIGN_CREATED, payload)
    logger.debug('[CollectionStore] Design created event', { id: design.id, name: design.name })
  }

  private emitDesignDeleted(id: string): void {
    const payload: DocumentDeletedPayload = { id, type: 'design' }
    void eventBusService.emit(DocumentEvents.DESIGN_DELETED, payload)
    logger.debug('[CollectionStore] Design deleted event', { id })
  }

  private emitDesignUpdated(design: ApiDesign): void {
    // The design-typed sibling of `emitRequestUpdated`: the renderer's
    // upsert re-instantiates via `ApiDesignClass`, so no section is
    // cleansed away. Same parent lookup for navigation re-keying.
    const parent = this.findParentFolder(design.id)
    const payload: DocumentChangedPayload = {
      id: design.id,
      type: 'design',
      document: design.toPlainObject(),
      ...(parent ? { parentFolderId: parent.id } : {})
    }
    void eventBusService.emit(DocumentEvents.DESIGN_UPDATED, payload)
    logger.debug('[CollectionStore] Design updated', { id: design.id, name: design.name })
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
      // `serializeValueForPersistence` which strips `SecretValue`
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
      // `SecretValue` plaintext survives the eventBus hop.
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
