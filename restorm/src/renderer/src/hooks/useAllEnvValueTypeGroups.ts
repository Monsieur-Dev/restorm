import { useEffect, useState } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { useRestormStore } from '../store/restormStore'
import { collectEnvValueTypeGroups, type EnvValueTypeGroup } from './collectEnvValueTypeGroups'

export type { EnvValueTypeGroup } from './collectEnvValueTypeGroups'
export { collectEnvValueTypeGroups } from './collectEnvValueTypeGroups'

/**
 * Reads the live collections from the store and refreshes on `FOLDER_UPDATED`
 * (env folders mutate in place when the user edits the "Variables
 * personnalisées" tab, so the store reference doesn't always change). Returns
 * one group per env folder so the type-pick menu can group enum/custom types
 * by API. Mirrors {@link useAllEnvValueTypes}.
 */
export function useAllEnvValueTypeGroups(): EnvValueTypeGroup[] {
  const collections = useRestormStore((s) => s.collections)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const sub = eventBus.subscribe(DocumentEvents.FOLDER_UPDATED, () => {
      setVersion((v) => v + 1)
    })
    return () => { sub.unsubscribe() }
  }, [])

  // Computed inline (not memoised) so it re-reads the live folder proxies on
  // every render — folders mutate in place, so a `FOLDER_UPDATED` event bumps
  // `version` to force the re-read after an edit in "Variables personnalisées".
  void version
  return collectEnvValueTypeGroups(collections)
}
