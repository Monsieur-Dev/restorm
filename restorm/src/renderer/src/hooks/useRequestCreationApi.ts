import { useCallback } from 'react'
import { eventBus, navigationService } from 'electron-core-ui/renderer'
import type { OperationDocumentation } from '../../../shared/types/apiDocumentation'
import type { Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder } from '../../../shared/types/collections'
import { DocumentEvents } from '../services/DocumentEvents'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import { buildRequestFromOperation } from '../services/buildRequestFromOperation'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import type { CreateFromOperationOptions, RequestCreationApi } from '../contexts/requestCreationContextValue'
import type { BreadcrumbItem } from '../../../shared/types/editor'

interface UseRequestCreationApiOptions {
  rootItems: FolderItem[]
  setRootItems: React.Dispatch<React.SetStateAction<FolderItem[]>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  /** The rendered multi-selection array. The sidebar highlights THIS when it is
   * non-empty, falling back to the `selectedItemId` anchor only when empty — so
   * a creation that moves the selection must set both, exactly like a sidebar
   * click (`useNavigation`'s `selectSingle`). Anchor-only leaves the new row
   * unhighlighted the moment the user has clicked anything in the tree. */
  setSelectedItemIds: React.Dispatch<React.SetStateAction<string[]>>
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[]) => void
}

function generateId(seed: string): string {
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Deliver a creation event on BOTH buses, like the sidebar Add path
 * (`useItemOperations.emitBothBuses`). `emitSync` reaches the main-process
 * subscribers (search index, ContextService); `emitLocalSync` reaches the
 * renderer-local save-unit bridge that marks the new unit DIRTY — which is what
 * drives autosave and the unsaved-window indicator. A main-only delivery
 * indexes for search but never marks dirty, so a request created from the docs
 * viewer silently vanishes on close in autosave-off mode, and prompts to save
 * even with autosave ON. See the same note in `useItemOperations.ts`.
 */
function emitCreatedOnBothBuses(event: string, payload: Record<string, unknown>): void {
  eventBus.emitSync(event, payload)
  eventBus.emitLocalSync(event, payload)
}

function findEnvFolderById(items: FolderItem[], id: string): EnvironmentFolder | null {
  for (const item of items) {
    if (isEnvironmentFolder(item) && item.id === id) return item
  }
  return null
}

function findFolderInItems(items: FolderItem[], id: string): Folder | EnvironmentFolder | null {
  for (const item of items) {
    if (isAnyFolder(item)) {
      if (item.id === id) return item
      const found = findFolderInItems(item.items, id)
      if (found) return found
    }
  }
  return null
}

function findChildFolderByName(parent: Folder | EnvironmentFolder, name: string): Folder | EnvironmentFolder | null {
  for (const item of parent.items) {
    if (isAnyFolder(item) && item.name === name) return item
  }
  return null
}

function buildBreadcrumbsForRequest(
  rootItems: FolderItem[],
  envFolderId: string,
  parentFolderId: string | undefined,
  request: Request
): BreadcrumbItem[] {
  const env = findEnvFolderById(rootItems, envFolderId)
  if (!env) return [{ id: request.id, label: request.name, icon: null }]
  const crumbs: BreadcrumbItem[] = [{ id: env.id, label: env.name, icon: null }]
  if (parentFolderId !== undefined && parentFolderId !== env.id) {
    const folder = findFolderInItems(env.items, parentFolderId)
    if (folder) crumbs.push({ id: folder.id, label: folder.name, icon: null })
  }
  crumbs.push({ id: request.id, label: request.name, icon: null })
  return crumbs
}

/**
 * Build the `RequestCreationApi` against the App-level state +
 * tab-opener handles. Wraps `buildRequestFromOperation` (pure) with
 * the side-effects required to land the request in the user's
 * workspace: tag-folder ensure, reactive mount, sidebar updates,
 * event emission, tab open.
 */
export function useRequestCreationApi(opts: UseRequestCreationApiOptions): RequestCreationApi {
  const { rootItems, setRootItems, setExpandedIds, setSelectedItemId, setSelectedItemIds, openAnyRequestTab } = opts

  const createFromOperation = useCallback(
    (operation: OperationDocumentation, options: CreateFromOperationOptions): string | undefined => {
      const envFolder = findEnvFolderById(rootItems, options.envFolderId)
      if (!envFolder) return undefined

      // Resolve the target folder. Explicit `parentFolderId` (folder
      // Docs2 view) wins; otherwise we look for a tag-folder that
      // matches the operation's `group` and create it on demand.
      let targetFolder: Folder | EnvironmentFolder = envFolder
      if (options.parentFolderId !== undefined) {
        const explicit = findFolderInItems(envFolder.items, options.parentFolderId)
        if (explicit) targetFolder = explicit
      } else if (operation.group !== undefined && operation.group.length > 0) {
        const existing = findChildFolderByName(envFolder, operation.group)
        if (existing) {
          targetFolder = existing
        } else {
          const newTagFolder: Folder = {
            id: generateId(`folder:tag:${operation.group}`),
            name: operation.group,
            tags: [operation.group],
            configuration: {},
            items: []
          }
          const reactiveTagFolder = makeReactiveFolder(newTagFolder)
          envFolder.items.push(reactiveTagFolder)
          emitCreatedOnBothBuses(DocumentEvents.FOLDER_CREATED, {
            id: reactiveTagFolder.id,
            type: 'folder',
            // `cloneForEventBus` preserves `SecretValue` plaintext on
            // the way to main (matters when an ancestor env carries
            // secrets the new folder inherits in handlebars scope).
            document: cloneForEventBus(reactiveTagFolder),
            parentFolderId: envFolder.id
          })
          targetFolder = reactiveTagFolder
        }
      }

      // Build the request, mount under the target folder. Pass the doc's
      // models so the builder can reconstruct the request body (parity with a
      // normal import); a Map keyed by model name is what the builder expects.
      const models = options.models !== undefined ? new Map(Object.entries(options.models)) : undefined
      const request = buildRequestFromOperation(operation, models, options.baseUrlPrefix)
      const reactiveRequest = makeReactiveRequest(request, targetFolder.id)
      targetFolder.items.push(reactiveRequest)

      emitCreatedOnBothBuses(DocumentEvents.REQUEST_CREATED, {
        id: reactiveRequest.id,
        type: 'request',
        document: cloneForEventBus(reactiveRequest),
        parentFolderId: targetFolder.id
      })

      // Nudge the sidebar so the new row + ancestor folders show up, then move
      // the selection exactly like a sidebar click: set BOTH the anchor and the
      // rendered array (`selectSingle`), so the new row is highlighted even
      // after a prior multi-selection has populated the array.
      setRootItems((prev) => [...prev])
      setExpandedIds((prev) => Array.from(new Set([...prev, envFolder.id, targetFolder.id])))
      setSelectedItemId(reactiveRequest.id)
      setSelectedItemIds([reactiveRequest.id])

      const crumbs = buildBreadcrumbsForRequest(
        rootItems,
        envFolder.id,
        targetFolder.id === envFolder.id ? undefined : targetFolder.id,
        reactiveRequest
      )
      openAnyRequestTab(reactiveRequest, crumbs)
      // Route the selection through the same NavigationService a sidebar/search
      // click uses, so history/back-forward + MRU treat a doc-created request
      // identically (doc-built requests are always HTTP).
      navigationService.navigateTo(reactiveRequest.id, 'sidebar', { type: 'http-request' })
      return reactiveRequest.id
    },
    [rootItems, setRootItems, setExpandedIds, setSelectedItemId, setSelectedItemIds, openAnyRequestTab]
  )

  return { createFromOperation }
}
