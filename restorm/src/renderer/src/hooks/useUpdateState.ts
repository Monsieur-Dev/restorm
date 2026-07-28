import { useCallback, useEffect, useState } from 'react'
import type { UpdateSettings, UpdateState } from '../../../shared/update/updateTypes'

export interface UseUpdateState {
  /** Live update state, or null until the first fetch resolves. */
  state: UpdateState | null
  /** Update settings (auto-check flag + current version), or null until fetched. */
  settings: UpdateSettings | null
  /** Trigger a manual check. */
  checkNow: () => Promise<void>
  /** Quit and install a downloaded update. */
  quitAndInstall: () => Promise<void>
  /** Toggle the periodic auto-check. */
  setAutoCheckEnabled: (enabled: boolean) => Promise<void>
}

/**
 * Subscribe to the main-process auto-update state. Fetches the initial state +
 * settings on mount and stays in sync via the `onStateChanged` broadcast — one
 * IPC listener per mounted consumer, detached on unmount. Safe when the bridge
 * is absent (e.g. a stripped test env): everything no-ops and state stays null.
 */
export function useUpdateState(): UseUpdateState {
  const [state, setState] = useState<UpdateState | null>(null)
  const [settings, setSettings] = useState<UpdateSettings | null>(null)

  useEffect(() => {
    const api = window.api.update
    void api.getState().then(setState)
    void api.getSettings().then(setSettings)
    return api.onStateChanged(setState)
  }, [])

  const checkNow = useCallback(async (): Promise<void> => {
    setState(await window.api.update.checkNow())
  }, [])

  const quitAndInstall = useCallback(async (): Promise<void> => {
    await window.api.update.quitAndInstall()
  }, [])

  const setAutoCheckEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    setSettings(await window.api.update.setAutoCheckEnabled(enabled))
  }, [])

  return { state, settings, checkNow, quitAndInstall, setAutoCheckEnabled }
}
