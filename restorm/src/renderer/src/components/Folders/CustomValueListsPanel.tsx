import React, { useCallback } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import type { EnvironmentFolder, CustomValueList } from '../../../../shared/types/collections'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { CustomValueListsEditor } from './CustomValueListsEditor'

/** Direct assignment triggers the reactive proxy's set trap. */
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  (obj as Record<K, T[K]>)[key] = value
}

export interface CustomValueListsPanelProps {
  folder: EnvironmentFolder
  onFolderChange?: ((folder: EnvironmentFolder) => void) | undefined
}

/**
 * An env folder's user-defined custom value lists ("Énumérations
 * personnalisées"): the shared `CustomValueListsEditor` master-details
 * UI, wired to FOLDER persistence. These are 100% user-managed, never
 * touched by spec re-import.
 *
 * The entries deliberately go through the plain ECUI table rather than
 * restorm's `RestormKeyValueTable`: an entry's `value` is a literal string
 * substituted at dispatch, so the typed-value cell would offer secrets,
 * dates and nested lists that the stored shape cannot round-trip.
 */
export const CustomValueListsPanel: React.FC<CustomValueListsPanelProps> = ({ folder, onFolderChange }) => {
  // Heavy write: mutate the reactive folder + notify the parent + fire
  // FOLDER_UPDATED so open request tabs re-read the lists (the KV-table
  // dropdown drops an unchecked entry instantly). `customValueLists`
  // isn't an indexable folder key, so the proxy doesn't auto-emit.
  const commit = useCallback((next: CustomValueList[]) => {
    updateReactiveProperty(folder, 'customValueLists', next)
    onFolderChange?.({ ...folder, customValueLists: next })
    eventBus.emitLocalSync(DocumentEvents.FOLDER_UPDATED, {
      type: 'folder',
      id: folder.id,
      document: folder
    } as DocumentChangedPayload)
    // Push the change to the main-side CollectionStore so the dispatch
    // resolver substitutes the new entry values. The reactive mutation
    // above stays in-renderer (in-place edits skip the sync memo), so
    // without this targeted IPC main keeps resolving the stale snapshot.
    const api = window.restorm?.apiUpdate
    void api?.updateFolderCustomValueLists(folder.id, next as unknown as unknown[])
  }, [folder, onFolderChange])

  return (
    <CustomValueListsEditor
      lists={folder.customValueLists ?? []}
      onListsChange={commit}
      entriesPersistenceId={`custom-value-list:${folder.id}`}
    />
  )
}
