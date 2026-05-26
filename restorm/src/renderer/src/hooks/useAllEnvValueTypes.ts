import { useEffect, useState } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { useRestormStore } from '../store/restormStore'
import { collectAllEnvValueTypes, type AllEnvValueTypes } from './collectAllEnvValueTypes'

export type { AllEnvValueTypes } from './collectAllEnvValueTypes'
export { collectAllEnvValueTypes } from './collectAllEnvValueTypes'

/**
 * Reads the live collections from the store and refreshes on `FOLDER_UPDATED`
 * (env folders mutate in place when the user edits the "Variables
 * personnalisées" tab, so the store reference doesn't always change). Used by
 * scenario nodes, which aren't tied to a single request's owning env folder
 * and want every defined type.
 */
export function useAllEnvValueTypes(): AllEnvValueTypes {
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
  return collectAllEnvValueTypes(collections)
}
