import React, { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'

export interface TabContainedOverlayProps {
  children: React.ReactNode
}

/**
 * Portals its children into the nearest ancestor `.restorm-workbench-tab`
 * element, so an `absolute; inset: 0` backdrop inside `children` scopes to
 * the WHOLE workbench tab (header + sub-tab bar + content) rather than to
 * whatever positioned sub-container the modal happens to be rendered in
 * (a request body, a scenario editor canvas, …).
 *
 * Resolves the tab element from an invisible anchor via a callback ref
 * (so no setState-in-effect), then portals the overlay there. Falls back
 * to inline rendering if no `.restorm-workbench-tab` ancestor is found.
 */
export const TabContainedOverlay: React.FC<TabContainedOverlayProps> = ({ children }) => {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const setAnchor = useCallback((el: HTMLSpanElement | null) => {
    if (!el) return
    const tab = el.closest('.restorm-workbench-tab')
    setTarget(tab instanceof HTMLElement ? tab : null)
  }, [])

  return (
    <>
      <span ref={setAnchor} style={{ display: 'none' }} aria-hidden="true" />
      {target ? createPortal(children, target) : children}
    </>
  )
}

export default TabContainedOverlay
