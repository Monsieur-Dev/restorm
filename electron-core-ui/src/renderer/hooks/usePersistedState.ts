import React, { useCallback, useEffect, useRef, useState } from 'react'
import { logger as defaultLogger } from '../services/logger'
import { getStorageAPI } from './useStorage'

export interface UsePersistedStateOptions<T> {
  /** Debounce window for writes, in milliseconds. Default: 300. */
  debounceMs?: number
  /**
   * Transform the value read from storage before applying it to state.
   * Return `undefined` to ignore the stored value and keep the current state
   * (e.g. migrate a legacy schema or drop all stored ids as invalid).
   *
   * Called with the most recent closure at read time, so it can reference
   * external data such as the currently-loaded tree without re-triggering a
   * read when that data changes.
   */
  onRestore?: (stored: T) => T | undefined
  /**
   * Called when the storage read completes with no entry for the current
   * key (`undefined` / `null`). Use to produce a runtime-derived default
   * that can't be expressed as the static `initial` value — e.g. "expand
   * every folder" when we finally know the tree shape. Return the new
   * value or `undefined` to leave state untouched.
   *
   * Always reads the most recent closure, so it sees the latest runtime
   * context without triggering re-reads.
   */
  onMissing?: () => T | undefined
  /**
   * Optional logger override — useful for tests. Falls back to the shared
   * library logger.
   */
  logger?: { warn: (message: string, meta?: unknown) => void }
}

/**
 * `useState`-shaped hook that persists its value under `key` in
 * `window.api.storage`.
 *
 * Semantics:
 *
 * - `key = null | undefined` → the hook is dormant: no IO, behaves like a
 *   plain `useState(initial)`. Useful when the key depends on a filePath
 *   that's not available yet (welcome screen, app boot).
 * - `key = "foo"` → reads storage asynchronously on mount / key change;
 *   if a stored value exists, it is passed through `onRestore` (if any)
 *   and applied via `setState`. If nothing is stored, the current state
 *   is kept as-is — **this hook never deletes storage on its own**.
 * - On every subsequent state change, a write is scheduled and debounced
 *   by `debounceMs` (default 300 ms). Writes emitted during the initial
 *   async restore are suppressed, so the restored value is never
 *   rewritten right after being read.
 * - Changing `key` resets the restore guard, cancels the pending write,
 *   and re-reads for the new key.
 *
 * Intentionally does NOT own the state shape: consumers that need a more
 * complex restore (filter stale ids, merge with an in-memory default,
 * schema migration) plug it in via `onRestore`.
 */
export function usePersistedState<T>(
  key: string | null | undefined,
  initial: T,
  options?: UsePersistedStateOptions<T>
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const debounceMs = options?.debounceMs ?? 300
  const log = options?.logger ?? defaultLogger

  const [state, setState] = useState<T>(initial)

  // Always call the caller's latest callback closures — this keeps `options`
  // off the effect dependency arrays (which would otherwise cause spurious
  // re-reads on every render).
  const onRestoreRef = useRef(options?.onRestore)
  useEffect(() => {
    onRestoreRef.current = options?.onRestore
  }, [options?.onRestore])

  const onMissingRef = useRef(options?.onMissing)
  useEffect(() => {
    onMissingRef.current = options?.onMissing
  }, [options?.onMissing])

  const loggerRef = useRef(log)
  useEffect(() => { loggerRef.current = log }, [log])

  // Track which key we have restored for, so the debounced write effect can
  // gate itself to "after restore for the current key only".
  const restoredKeyRef = useRef<string | null>(null)

  // Coordinate cancellation between the read effect and key changes.
  const pendingReadKeyRef = useRef<string | null>(null)

  // Last value we synced with storage (either read from it or wrote to it),
  // serialized. Used to suppress no-op writes — notably the write that would
  // otherwise immediately echo back a freshly-restored value.
  const lastSyncedSignatureRef = useRef<string | null>(null)

  // Read on mount / key change.
  useEffect(() => {
    if (!key) {
      restoredKeyRef.current = null
      lastSyncedSignatureRef.current = null
      return
    }

    pendingReadKeyRef.current = key
    restoredKeyRef.current = null
    lastSyncedSignatureRef.current = null
    const thisReadKey = key

    const api = getStorageAPI()
    if (!api) {
      restoredKeyRef.current = thisReadKey
      return
    }

    void (async () => {
      try {
        const stored = await api.get(thisReadKey)
        // Ignore the result if the key changed while we were awaiting.
        if (pendingReadKeyRef.current !== thisReadKey) return
        if (stored !== undefined && stored !== null) {
          const next = onRestoreRef.current
            ? onRestoreRef.current(stored as T)
            : (stored as T)
          if (next !== undefined) {
            lastSyncedSignatureRef.current = JSON.stringify(next)
            setState(next)
          }
        } else if (onMissingRef.current) {
          const fallback = onMissingRef.current()
          if (fallback !== undefined) {
            lastSyncedSignatureRef.current = JSON.stringify(fallback)
            setState(fallback)
          }
        }
      } catch (error: unknown) {
        loggerRef.current.warn('[usePersistedState] failed to read', {
          key: thisReadKey,
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        if (pendingReadKeyRef.current === thisReadKey) {
          restoredKeyRef.current = thisReadKey
        }
      }
    })()

    return () => {
      // A new key arrived (or we unmounted) — any in-flight read result must
      // not land on the new key's state.
      if (pendingReadKeyRef.current === thisReadKey) {
        pendingReadKeyRef.current = null
      }
    }
  }, [key])

  // Debounced write — only after the restore phase has completed for the
  // current key, and only when state diverges from what we last synced, so
  // the freshly-read value isn't immediately rewritten.
  useEffect(() => {
    if (!key) return
    if (restoredKeyRef.current !== key) return

    const signature = JSON.stringify(state)
    if (signature === lastSyncedSignatureRef.current) return

    const api = getStorageAPI()
    if (!api) return

    const handle = setTimeout(() => {
      lastSyncedSignatureRef.current = signature
      api.set(key, state).catch((error: unknown) => {
        loggerRef.current.warn('[usePersistedState] failed to write', {
          key,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }, debounceMs)

    return () => { clearTimeout(handle) }
  }, [key, state, debounceMs])

  // A stable setter reference, mirroring React's useState contract so
  // consumers can pass it to other hooks that depend on identity.
  const stableSetState = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (update) => { setState(update) },
    []
  )

  return [state, stableSetState]
}
