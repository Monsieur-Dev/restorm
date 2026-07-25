import { useCallback, useEffect, useId, useRef } from 'react'

/** Shared announce channel. Every participating popover — library or host
 * application — listens on this one `document`-level event, which is what
 * makes a single set possible across components that know nothing about
 * each other. */
const OPEN_EVENT = 'ecui:popover-open'

/**
 * Mutual exclusion for anchored click-popovers: at most one is open at a
 * time, application-wide.
 *
 * On opening, a popover announces itself on a shared `document` event
 * carrying a per-instance id; every other participant that is currently
 * open closes itself. Two properties matter:
 *
 * - The announce is dispatched **directly on `document`**, so it is immune
 *   to the `onMouseDown={e => e.stopPropagation()}` wrappers popovers
 *   commonly use to protect themselves from their own outside-click
 *   listener. A sibling's `mousedown`-based dismissal never fires in that
 *   situation, which is the bug this hook exists to solve.
 * - Participation is by subscription, not by registry: a component opts in
 *   by calling this hook, and nothing needs to know the full set. That
 *   keeps the set correct as popovers are added.
 *
 * `close` is read through a ref, so passing a fresh closure each render
 * neither re-subscribes nor re-announces.
 *
 * @param open  whether this popover is currently open
 * @param close closes this popover; invoked when another one opens
 */
export function useExclusivePopover(open: boolean, close: () => void): void {
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

export default useExclusivePopover
