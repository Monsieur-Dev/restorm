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
  const previousState = useRef(new Map<string, { kind: ApiUpdateState['kind']; version?: string }>())

  useEffect(() => {
    const api = getApiUpdateApi()
    if (!api) return
    const unsubscribe = api.onStateChanged(({ folderId, state }) => {
      const prev = previousState.current.get(folderId)
      previousState.current.set(folderId, { kind: state.kind, ...(state.availableVersion !== undefined ? { version: state.availableVersion } : {}) })

      if (state.kind === 'available') {
        // Fire on transition into 'available' — but also re-fire if
        // the same folder is already 'available' and a newer version
        // arrives. Without the version check, a follow-up check that
        // surfaces a third spec bump would stay silent until the
        // user manually visited the folder home.
        const isFreshTransition = prev?.kind !== 'available'
        const isNewerVersion = prev?.kind === 'available' && state.availableVersion !== undefined && prev.version !== state.availableVersion
        if (!isFreshTransition && !isNewerVersion) return
        toasterService.push('app', {
          id: `apiUpdate:${folderId}`,
          title: t('folderView.home.apiUpdate.stateAvailable'),
          body: state.availableVersion
            ? `${state.currentVersion ?? '?'} → ${state.availableVersion}`
            : t('folderView.home.apiUpdate.stateAvailable'),
          durationMs: 8_000
        })
        return
      }

      if (state.kind === 'error' && typeof state.error === 'string' && !state.error.startsWith('Auto-check failed:')) {
        // Auto-check errors stay silent (they prefix the message
        // with "Auto-check failed:" so the renderer can tell the
        // two apart). Manual checks surface a transient toast so
        // the user sees the failure even off-screen.
        toasterService.push('app', {
          id: `apiUpdate-error:${folderId}`,
          title: t('folderView.home.apiUpdate.stateError'),
          body: state.error,
          durationMs: 5_000
        })
      }
    })
    return unsubscribe
  }, [t])
}
