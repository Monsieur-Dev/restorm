import { useEffect, useMemo, useRef } from 'react'

/**
 * Returns a stable callback that invokes `fn` once `delayMs` has elapsed
 * since the *last* invocation. Subsequent calls within the window reset
 * the timer.
 *
 * Use this when you can't reshape a side effect through a debounced value
 * — e.g. a `KeyValueTable` row change handler that batches updates per
 * keystroke and forwards them to the persistence layer.
 *
 * The returned function:
 * - Is referentially stable across renders, so it's safe to pass to
 *   memoized children or to use as a `useEffect` dependency.
 * - Always invokes the latest `fn` closure (no stale-closure bug if
 *   `fn` references React state).
 * - Carries a `.cancel()` to drop a pending invocation, and a
 *   `.flush()` to fire it immediately with the latest pending args.
 *
 * On unmount the pending timer is cleared.
 */
export interface DebouncedCallback<TArgs extends unknown[]> {
  (...args: TArgs): void
  /** Drop the pending invocation, if any. */
  cancel: () => void
  /** Fire the pending invocation immediately with its captured args. */
  flush: () => void
}

export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number
): DebouncedCallback<TArgs> {
  // Always call the latest closure — React effects can mutate state the
  // caller closed over, and we don't want to lock in stale state.
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn }, [fn])

  const delayRef = useRef(delayMs)
  useEffect(() => { delayRef.current = delayMs }, [delayMs])

  const handleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgsRef = useRef<TArgs | null>(null)

  // Build the callable + its methods in a single memo so the returned
  // shape never changes identity across renders. Hooks-immutability
  // lint forbids reassigning fields on a useCallback return — building
  // the function here avoids that pattern entirely.
  const debounced = useMemo<DebouncedCallback<TArgs>>(() => {
    const cancel = (): void => {
      if (handleRef.current !== null) {
        clearTimeout(handleRef.current)
        handleRef.current = null
      }
      pendingArgsRef.current = null
    }

    const flush = (): void => {
      if (handleRef.current !== null) {
        clearTimeout(handleRef.current)
        handleRef.current = null
      }
      if (pendingArgsRef.current !== null) {
        const args = pendingArgsRef.current
        pendingArgsRef.current = null
        fnRef.current(...args)
      }
    }

    const debouncedFn = ((...args: TArgs): void => {
      pendingArgsRef.current = args
      if (handleRef.current !== null) clearTimeout(handleRef.current)
      handleRef.current = setTimeout(() => {
        handleRef.current = null
        const pending = pendingArgsRef.current
        pendingArgsRef.current = null
        if (pending !== null) fnRef.current(...pending)
      }, delayRef.current)
    }) as DebouncedCallback<TArgs>

    debouncedFn.cancel = cancel
    debouncedFn.flush = flush
    return debouncedFn
  }, [])

  // Clear pending timers on unmount so a stale write never lands on a
  // detached consumer.
  useEffect(() => () => { debounced.cancel() }, [debounced])

  return debounced
}
