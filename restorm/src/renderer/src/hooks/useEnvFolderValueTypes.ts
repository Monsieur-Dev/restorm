import { useEffect, useState } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { useRestormStore } from '../store/restormStore'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'

export interface EnvFolderValueTypes {
  enumDefinitions: EnvironmentFolder['enumDefinitions']
  customValueLists: EnvironmentFolder['customValueLists']
  /** Id of the nearest ancestor env-folder, or undefined if none. */
  envFolderId: string | undefined
}

/**
 * Resolve the enum definitions + custom value lists from the nearest
 * ancestor `EnvironmentFolder` of a request, so every protocol's
 * KeyValue tables can offer the "API defined types" / "Custom types"
 * submenus and render their dropdowns.
 *
 * Computed inline (not memoised) so it re-reads the live folder proxy on
 * every render — the folder mutates in place, so a `FOLDER_UPDATED`
 * event bumps a counter to force the re-read after an edit in the
 * "Variables personnalisées" tab.
 */
export function useEnvFolderValueTypes(requestId: string): EnvFolderValueTypes {
  const findParentFolder = useRestormStore((state) => state.findParentFolder)
  const [folderListsVersion, setFolderListsVersion] = useState(0)
  void folderListsVersion

  let enumDefinitions: EnvironmentFolder['enumDefinitions']
  let customValueLists: EnvironmentFolder['customValueLists']
  let envFolderId: string | undefined
  {
    let current: ReturnType<typeof findParentFolder> = findParentFolder(requestId)
    while (current) {
      if ('folderType' in current && (current as { folderType?: string }).folderType === 'environment') {
        const env = current as unknown as EnvironmentFolder
        enumDefinitions = env.enumDefinitions
        customValueLists = env.customValueLists
        envFolderId = env.id
        break
      }
      current = findParentFolder(current.id)
    }
  }

  useEffect(() => {
    const sub = eventBus.subscribe(DocumentEvents.FOLDER_UPDATED, (payload: { id: string }) => {
      if (envFolderId !== undefined && payload.id === envFolderId) setFolderListsVersion((v) => v + 1)
    })
    return () => { sub.unsubscribe() }
  }, [envFolderId])

  return { enumDefinitions, customValueLists, envFolderId }
}
