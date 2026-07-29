/**
 * A scripted fake `UpdaterEngine` used ONLY when `RESTORM_UPDATE_MOCK` is set —
 * for e2e + manual QA of the auto-update UI without a real release feed. The env
 * value selects the scenario:
 *   - unset / "uptodate" → a check reports no update available.
 *   - "available"        → a check finds + "downloads" an update.
 *   - "downloaded"       → a check finds and fully downloads an update.
 *
 * Events are emitted on the next tick so the renderer observes the same
 * transitions it would from electron-updater.
 */
import type { UpdaterEngine } from './UpdateService'

type MockMode = 'uptodate' | 'available' | 'downloaded'

function normalizeMode(raw: string | undefined): MockMode {
  if (raw === 'available' || raw === 'downloaded') return raw
  return 'uptodate'
}

export function createMockUpdaterEngine(rawMode: string | undefined): UpdaterEngine {
  const mode = normalizeMode(rawMode)
  const handlers: Record<string, ((...a: unknown[]) => void)[] | undefined> = {}
  const emit = (event: string, ...args: unknown[]): void => {
    for (const h of handlers[event] ?? []) h(...args)
  }
  const MOCK_VERSION = '99.0.0'

  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event, listener) {
      const bucket = handlers[event] ?? []
      handlers[event] = bucket
      bucket.push(listener)
    },
    checkForUpdates() {
      // Emit `checking` first, then the RESULT on a later tick — real
      // electron-updater spaces these out (network latency), and the renderer
      // relies on observing the transient `checking` state (e.g. to show the
      // "you're up to date" note after a manual check). Emitting both in one
      // tick would let React batch them into a single render and swallow it.
      setTimeout(() => {
        emit('checking-for-update')
      }, 0)
      setTimeout(() => {
        if (mode === 'uptodate') {
          emit('update-not-available', {})
          return
        }
        emit('update-available', { version: MOCK_VERSION })
        if (mode === 'downloaded') {
          emit('download-progress', { percent: 100 })
          emit('update-downloaded', { version: MOCK_VERSION })
        }
      }, 40)
      return Promise.resolve(null)
    },
    downloadUpdate() {
      setTimeout(() => {
        emit('download-progress', { percent: 100 })
        emit('update-downloaded', { version: MOCK_VERSION })
      }, 0)
      return Promise.resolve(null)
    },
    quitAndInstall(_isSilent?: boolean, _isForceRunAfter?: boolean) {
      // No-op in the mock — we never actually relaunch during e2e/QA.
    }
  }
}
