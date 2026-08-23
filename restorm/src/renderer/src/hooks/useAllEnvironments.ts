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
 * the store reference doesn't always change) as well as the environment-level
 * events — renaming / re-iconing an environment fires `ENVIRONMENT_UPDATED`
 * (not `FOLDER_UPDATED`), and add/remove fire CREATED/DELETED / the folder's
 * env-set change — so without these a rename left the flattened list stale.
 */
export function useAllEnvironments(): FlatEnvRow[] {
  const collections = useRestormStore((s) => s.collections)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const bump = (): void => { setVersion((v) => v + 1) }
    const subs = [
      DocumentEvents.FOLDER_UPDATED,
      DocumentEvents.ENVIRONMENT_CREATED,
      DocumentEvents.ENVIRONMENT_UPDATED,
      DocumentEvents.ENVIRONMENT_DELETED,
      DocumentEvents.ENV_FOLDER_ENV_CHANGED
    ].map((evt) => eventBus.subscribe(evt, bump))
    return () => { for (const sub of subs) sub.unsubscribe() }
  }, [])

  // Computed inline (not memoised) so it re-reads the live folder proxies on
  // every render — folders mutate in place, so a `FOLDER_UPDATED` event bumps
  // `version` to force the re-read. Mirrors `useAllEnvValueTypes`.
  void version
  return collectAllEnvironments(collections)
}
