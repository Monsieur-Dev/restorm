import { useEffect, useRef, useState } from 'react'

/**
 * Returns a value that follows `value` after a `delayMs` quiet period.
 *
 * Use this to feed rapidly-changing controlled inputs into a side-effecting
 * consumer (event bus, IPC, search index, autosave, persistence) without
 * firing on every keystroke. Pair with a `useEffect` that depends on the
 * returned value:
 *
 * ```ts
 * const debouncedQuery = useDebouncedValue(query, 250)
 * useEffect(() => { runSearch(debouncedQuery) }, [debouncedQuery])
 * ```
 *
 * Semantics:
 * - The first render returns `value` synchronously (no delay before the
 *   initial paint).
 * - Each subsequent change to `value` schedules a `delayMs` timer; if the
 *   value changes again before it fires, the timer resets.
 * - On unmount the pending timer is cleared, so a stale write never lands
 *   after the consumer has gone away.
 * - `delayMs` changes are honored on the next value change.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  const isFirstRenderRef = useRef(true)

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }

    const handle = setTimeout(() => { setDebounced(value) }, delayMs)
    return () => { clearTimeout(handle) }
  }, [value, delayMs])

  return debounced
}
