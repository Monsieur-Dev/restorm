import { useEffect, useState } from 'react'
import type { ApiUpdateState } from '../../../shared/types/baseTypes'

/**
 * Subscribe to `apiUpdate:state-changed` and surface the live
 * `Record<folderId, ApiUpdateState>` to React. Used by the sidebar
 * to drive folder badges, and by the env-folder home page to mirror
 * the same state.
 *
 * The hook initialises by calling `getSnapshot` so a folder that
 * was already in the `'available'` state when the renderer mounted
 * still gets its badge — without this, the badge would only appear
 * on the next checker tick.
 */
interface ApiUpdateApi {
  getSnapshot: () => Promise<Record<string, unknown>>
  onStateChanged: (callback: (data: { folderId: string; state: unknown }) => void) => (() => void)
}

function getApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

export function useApiUpdateStateMap(): Record<string, ApiUpdateState> {
  const [map, setMap] = useState<Record<string, ApiUpdateState>>({})

  useEffect(() => {
    const api = getApi()
    if (!api) return
    let alive = true
    void api.getSnapshot().then((snapshot) => {
      if (!alive) return
      setMap(snapshot as Record<string, ApiUpdateState>)
    })
    const unsubscribe = api.onStateChanged((evt) => {
      setMap((prev) => ({ ...prev, [evt.folderId]: evt.state as ApiUpdateState }))
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return map
}
