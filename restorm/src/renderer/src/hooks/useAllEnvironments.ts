import { useEffect, useState } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'
import { useRestormStore } from '../store/restormStore'
import { collectAllEnvironments } from './collectAllEnvironments'
import type { FlatEnvRow } from '../components/MainView/envSelectorHelpers'

export { collectAllEnvironments } from './collectAllEnvironments'

/**
 * Every environment across every environment folder of the open project,
 * flattened for the env picker. Reads the live collections from the store and
 * refreshes on `FOLDER_UPDATED` (env folders mutate in place when edited, so
 * the store reference doesn't always change).
 */
export function useAllEnvironments(): FlatEnvRow[] {
  const collections = useRestormStore((s) => s.collections)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const sub = eventBus.subscribe(DocumentEvents.FOLDER_UPDATED, () => {
      setVersion((v) => v + 1)
    })
    return () => { sub.unsubscribe() }
  }, [])

  // Re-read the live folder proxies on every render (folders mutate in place);
  // `version` is bumped by FOLDER_UPDATED to force it after an edit.
  void version
  return collectAllEnvironments(collections)
}
