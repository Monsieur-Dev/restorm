import { useCallback, useEffect, useId, useRef } from 'react'

const OPEN_EVENT = 'restorm:header-popover-open'

/**
 * Mutual exclusion for the request-header click popovers (quick settings,
 * scenarios-using-request, scenario callers, …): opening one must close the
 * others, otherwise two anchored tooltips stack on top of each other.
 * Each caller announces its opening on a shared DOM event; every other
 * subscriber with an open popover closes itself.
 */
export function useExclusiveHeaderPopover(open: boolean, close: () => void): void {
  const id = useId()
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close }, [close])

  const onSiblingOpen = useCallback((e: Event): void => {
    if ((e as CustomEvent<string>).detail !== id) closeRef.current()
  }, [id])

  useEffect(() => {
    if (!open) return undefined
    document.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: id }))
    document.addEventListener(OPEN_EVENT, onSiblingOpen)
    return () => { document.removeEventListener(OPEN_EVENT, onSiblingOpen) }
  }, [open, id, onSiblingOpen])
}

export default useExclusiveHeaderPopover
