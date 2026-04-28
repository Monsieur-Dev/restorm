import { useEffect, useRef } from 'react'
import { toasterService } from 'electron-core-ui/renderer'
import type { TFunction } from 'i18next'
import type { ApiUpdateState } from '../../../shared/types/baseTypes'

/**
 * Subscribe to `apiUpdate:state-changed` and push a toast each time
 * a folder transitions into the `'available'` state. Other
 * transitions (idle / checking / error) are silent — the inline
 * settings section already shows them, and a toast for every auto
 * tick would be noise.
 *
 * The hook also dedupes echoes: once a toast for folder F has
 * appeared in this session, subsequent `'available'` events for F
 * (for instance when a second auto-check confirms the same update)
 * update the existing toast in place rather than spawning a new one.
 */
interface ApiUpdateApi {
  onStateChanged: (callback: (data: { folderId: string; state: ApiUpdateState }) => void) => (() => void)
}

function getApiUpdateApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

export function useApiUpdateNotifications(t: TFunction): void {
  const previousState = useRef(new Map<string, ApiUpdateState['kind']>())

  useEffect(() => {
    const api = getApiUpdateApi()
    if (!api) return
    const unsubscribe = api.onStateChanged(({ folderId, state }) => {
      const prevKind = previousState.current.get(folderId)
      previousState.current.set(folderId, state.kind)
      if (state.kind !== 'available') return
      // Only fire on transition INTO 'available'. A repeat 'available'
      // (same folder, same state) is just an echo — we still update
      // the existing toast in place via the dedupe id, but the
      // transition guard keeps duplicates from being unhidden after
      // the user dismissed.
      if (prevKind === 'available') return
      toasterService.push('app', {
        id: `apiUpdate:${folderId}`,
        title: t('folderView.home.apiUpdate.stateAvailable'),
        body: state.availableVersion
          ? `${state.currentVersion ?? '?'} → ${state.availableVersion}`
          : t('folderView.home.apiUpdate.stateAvailable'),
        durationMs: 8_000
      })
    })
    return unsubscribe
  }, [t])
}
