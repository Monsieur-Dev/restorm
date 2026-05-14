import React, { useCallback, useMemo } from 'react'
import type { Folder, Request } from '../../../../shared/types/collections'
import type {
  ApiDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'
import type { RouteLike } from '../../../../shared/utils/findOperationForRoute'
import { useRestormStore } from '../../store/restormStore'
import { routeFromRequest } from '../../hooks/routeFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { mergeEnumDefinitionsIntoModels } from '../documentation/mergeEnumDefinitions'
import { useRequestCreation } from '../../contexts/useRequestCreation'
import { BaseFolderView } from './BaseFolderView'

export interface FolderViewProps {
  /** The folder to display */
  folder: Folder
  /** Called when folder data changes */
  onFolderChange?: (folder: Folder) => void
}

/**
 * Walk the folder's `items` recursively and yield every leaf
 * `Request` (any protocol). Sub-folders are descended into; non-
 * request items (sub-collections that aren't requests) are
 * skipped.
 */
function collectRequests(folder: Folder): Request[] {
  const out: Request[] = []
  const visit = (items: unknown[]): void => {
    for (const item of items) {
      if (item && typeof item === 'object') {
        const i = item as { type?: string; items?: unknown[] }
        if (typeof i.type === 'string' && Array.isArray(i.items)) {
          visit(i.items)
        } else if (typeof i.type === 'string') {
          out.push(item as Request)
        }
      }
    }
  }
  visit(folder.items as unknown as unknown[])
  return out
}

function apiDocFromItem(item: unknown): ApiDocumentation | undefined {
  if (item && typeof item === 'object' && 'apiDocumentation' in item) {
    return (item as { apiDocumentation?: ApiDocumentation }).apiDocumentation
  }
  return undefined
}

/**
 * View for displaying a standard Folder. Surfaces a Docs2 tab when
 * the folder lives under an env-folder that carries a structured
 * `apiDocumentation`: every request inside the folder becomes a
 * filter, and `DocumentationHost` renders the deduplicated set of
 * matching operations + their transitive model closure.
 */
export const FolderView: React.FC<FolderViewProps> = ({ folder, onFolderChange }) => {
  void onFolderChange

  const findOwningEnvironmentFolder = useRestormStore(state => state.findOwningEnvironmentFolder)
  const collections = useRestormStore(state => state.collections)
  const requestCreation = useRequestCreation()

  const owningEnvFolderId = findOwningEnvironmentFolder(folder.id)?.id
  const handleAddRequest = useCallback(
    (operation: OperationDocumentation): void => {
      if (!requestCreation || owningEnvFolderId === undefined) return
      requestCreation.createFromOperation(operation, {
        envFolderId: owningEnvFolderId,
        parentFolderId: folder.id
      })
    },
    [requestCreation, owningEnvFolderId, folder.id]
  )

  const docsContent = useMemo(() => {
    void collections
    const owning = findOwningEnvironmentFolder(folder.id)
    const rawApiDoc = owning ? apiDocFromItem(owning) : undefined
    if (!rawApiDoc) return undefined
    const apiDoc = mergeEnumDefinitionsIntoModels(rawApiDoc, owning?.enumDefinitions)

    const requests = collectRequests(folder)
    if (requests.length === 0) return undefined

    const filters: RouteLike[] = requests.map(routeFromRequest)
    // When the folder's name matches a tag/group declared in the
    // imported spec (`pet`, `store`, `user` for the Petstore), use
    // that group's description as the scope's blurb — readers
    // expect the tag-level prose ("Everything about your Pets"),
    // not a repeat of the folder name.
    const matchingGroup = apiDoc.groups[folder.name]
    const scopeDescription = matchingGroup?.description ?? undefined

    return (
      <DocumentationHost
        apiDocumentation={apiDoc}
        filters={filters}
        scopeTitle={folder.name}
        {...(scopeDescription !== undefined && scopeDescription.length > 0
          ? { scopeDescription }
          : {})}
        {...(requestCreation && owningEnvFolderId !== undefined
          ? { onAddRequest: handleAddRequest }
          : {})}
        testId={`folder-documentation-host-${folder.id}`}
      />
    )
  }, [folder, findOwningEnvironmentFolder, collections, handleAddRequest, requestCreation, owningEnvFolderId])

  return (
    <BaseFolderView
      folder={folder}
      {...(docsContent !== undefined ? { docsContent } : {})}
    />
  )
}

export default FolderView
