import { useCallback } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import type { OperationDocumentation } from '../../../shared/types/apiDocumentation'
import type { Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder } from '../../../shared/types/collections'
import { DocumentEvents } from '../services/DocumentEvents'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import { buildRequestFromOperation } from '../services/buildRequestFromOperation'
import type { CreateFromOperationOptions, RequestCreationApi } from '../contexts/requestCreationContextValue'
import type { BreadcrumbItem } from '../../../shared/types/editor'

interface UseRequestCreationApiOptions {
  rootItems: (Folder | EnvironmentFolder | Request)[]
  setRootItems: React.Dispatch<React.SetStateAction<(Folder | EnvironmentFolder | Request)[]>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[]) => void
}

function generateId(seed: string): string {
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function findEnvFolderById(items: (Folder | EnvironmentFolder | Request)[], id: string): EnvironmentFolder | null {
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
  rootItems: (Folder | EnvironmentFolder | Request)[],
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
  const { rootItems, setRootItems, setExpandedIds, setSelectedItemId, openAnyRequestTab } = opts

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
            documentation: '',
            tags: [operation.group],
            configuration: {},
            items: []
          }
          const reactiveTagFolder = makeReactiveFolder(newTagFolder)
          envFolder.items.push(reactiveTagFolder)
          eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
            id: reactiveTagFolder.id,
            type: 'folder',
            document: JSON.parse(JSON.stringify(reactiveTagFolder)) as Folder,
            parentFolderId: envFolder.id
          })
          targetFolder = reactiveTagFolder
        }
      }

      // Build the request, mount under the target folder.
      const request = buildRequestFromOperation(operation)
      const reactiveRequest = makeReactiveRequest(request, targetFolder.id)
      targetFolder.items.push(reactiveRequest)

      eventBus.emitSync(DocumentEvents.REQUEST_CREATED, {
        id: reactiveRequest.id,
        type: 'request',
        document: JSON.parse(JSON.stringify(reactiveRequest)) as Request,
        parentFolderId: targetFolder.id
      })

      // Nudge the sidebar so the new row + ancestor folders show up.
      setRootItems((prev) => [...prev])
      setExpandedIds((prev) => Array.from(new Set([...prev, envFolder.id, targetFolder.id])))
      setSelectedItemId(reactiveRequest.id)

      const crumbs = buildBreadcrumbsForRequest(
        rootItems,
        envFolder.id,
        targetFolder.id === envFolder.id ? undefined : targetFolder.id,
        reactiveRequest
      )
      openAnyRequestTab(reactiveRequest, crumbs)
      return reactiveRequest.id
    },
    [rootItems, setRootItems, setExpandedIds, setSelectedItemId, openAnyRequestTab]
  )

  return { createFromOperation }
}
