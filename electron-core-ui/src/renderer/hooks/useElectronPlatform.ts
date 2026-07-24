import { useEffect, useState } from 'react'

/**
 * The host platform as reported by the main process (`process.platform`):
 * `'darwin' | 'win32' | 'linux'` (or any other Node platform string).
 */
export type ElectronPlatform = string

/**
 * Read the host platform from the main process over the `platform` IPC.
 *
 * This is the single source of truth for platform-branched UI. Deriving the
 * platform from `navigator.userAgent` instead (as `usePlatform`'s
 * `isMacintosh` does) yields a different vocabulary ('MAC' vs 'darwin') and
 * can disagree with `process.platform`, so components that must match the
 * main process — window controls, title-bar insets — use this hook.
 *
 * @param override - Skip detection and use this value (tests, storybook).
 * @returns the platform string, or `undefined` until the IPC answers.
 */
export const useElectronPlatform = (override?: ElectronPlatform): ElectronPlatform | undefined => {
  const [detected, setDetected] = useState<ElectronPlatform | undefined>(undefined)

  useEffect(() => {
    // Capture the subscription once; re-subscribing on every render would
    // leak duplicate 'platform' listeners.
    if (override || !window.electronAPI?.onPlatform) return
    const dispose = window.electronAPI.onPlatform((platform: string) => {
      setDetected(platform)
    })
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, [override])

  return override ?? detected
}

export default useElectronPlatform
