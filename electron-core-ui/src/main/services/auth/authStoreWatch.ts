/**
 * Watch the shared auth cache for changes made by OTHER instances.
 *
 * Every instance of the host app resolves the same `userData`, so they all
 * read and write the same `auth-session.dat`. Watching it is what turns a
 * login, logout or plan change in one window into a live update in all of
 * them — without any instance ever being handed another's state: the watcher
 * only says "the file moved", and each instance re-reads and RE-VERIFIES the
 * signed entitlement itself.
 *
 * Two filesystem realities shape the implementation:
 *
 * - The store's writes are atomic (temp file + rename), and a rename replaces
 *   the watched inode. On Linux, `fs.watch` on the FILE goes silent after the
 *   first replacement. So we watch the PARENT DIRECTORY and filter events for
 *   our basename — the directory watch survives any number of replacements,
 *   and also sees the file's deletion (logout) and re-creation (next login).
 * - One logical write surfaces as a BURST of events (rename + change, platform
 *   dependent), so callbacks are debounced: a burst yields one `onChange`,
 *   fired after the burst has been quiet for `debounceMs`.
 *
 * Electron-free: the `fs.watch` shape and the timers are injectable, so tests
 * drive it with fakes and this module never imports node builtins at runtime
 * beyond `node:path` and the default `node:fs` implementation.
 */

import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

/** The slice of `fs.watch` this module needs (directory watch). */
export type WatchImpl = (
  directory: string,
  listener: (eventType: string, filename: string | Buffer | null) => void
) => Pick<FSWatcher, 'close'>

export interface AuthStoreWatchOptions {
  /** Absolute path of the auth cache file (`…/auth-session.dat`). */
  filePath: string
  /** Called once per quiet burst of events touching the file. */
  onChange: () => void
  /** Quiet window after the last event before `onChange` fires. Default 200 ms —
   * long enough to swallow a rename+change burst, short enough that a login in
   * one window feels instantaneous in the others. */
  debounceMs?: number
  /** Injectable `fs.watch` (tests). Defaults to the real one. */
  watchImpl?: WatchImpl
  /** Injectable timers (tests). Default to the global ones. */
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutImpl?: (handle: ReturnType<typeof setTimeout>) => void
  /** Called when the underlying watcher cannot be established or dies. The
   * feature degrades to the pre-watch behaviour (restart-to-propagate), which
   * must never break the app — so errors are reported, not thrown. */
  onError?: (err: unknown) => void
}

export interface AuthStoreWatchHandle {
  /** Stop watching and drop any pending debounce. Idempotent. */
  stop: () => void
}

/**
 * Start watching the auth cache. Returns a handle whose `stop()` must be called
 * on shutdown (or when auth is torn down) so the directory watch does not
 * outlive its service.
 */
export function startAuthStoreWatch(options: AuthStoreWatchOptions): AuthStoreWatchHandle {
  const {
    filePath,
    onChange,
    debounceMs = 200,
    watchImpl = (dir, listener) => fsWatch(dir, listener),
    setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutImpl = (handle) => { clearTimeout(handle) },
    onError = () => undefined
  } = options

  const fileName = basename(filePath)
  let pending: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const scheduleChange = (): void => {
    if (stopped) return
    if (pending !== null) clearTimeoutImpl(pending)
    pending = setTimeoutImpl(() => {
      pending = null
      if (!stopped) onChange()
    }, debounceMs)
  }

  let watcher: Pick<FSWatcher, 'close'> | null = null
  try {
    watcher = watchImpl(dirname(filePath), (_eventType, eventFile) => {
      // Some platforms report no filename at all; treat those as potentially
      // ours — a spurious reload is idempotent, a missed one loses the feature.
      if (eventFile === null || eventFile.toString() === fileName) scheduleChange()
    })
  } catch (err) {
    onError(err)
  }

  return {
    stop: (): void => {
      stopped = true
      if (pending !== null) {
        clearTimeoutImpl(pending)
        pending = null
      }
      try {
        watcher?.close()
      } catch {
        /* already closed */
      }
      watcher = null
    }
  }
}
