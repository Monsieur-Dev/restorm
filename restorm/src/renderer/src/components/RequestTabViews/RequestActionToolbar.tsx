import React, { useLayoutEffect, useRef, type ReactNode } from 'react'
import './requestActionToolbar.css'

export interface RequestActionToolbarProps {
  /** The action discs, in reading order. The PRIMARY action (send / run /
   * listen) comes last, so it sits rightmost — same reading order as the
   * scenario toolbar's green play. */
  children: ReactNode
  'data-testid'?: string | undefined
}

/** Clear gap kept between the title box and the bar's left edge (px). Small on
 * purpose: the title's own trailing padding (the edit-pencil slot) already adds
 * visual breathing room, so this only guards against sub-pixel rounding. */
const TITLE_CLEARANCE_PX = 4
/** The bar's own right inset from the tab edge — mirrors `right: 16px` in the
 * stylesheet. Part of the space the title must reserve. */
const BAR_RIGHT_INSET_PX = 16

/**
 * Fixed action bar for a request tab: a row of round action buttons anchored
 * to the top-right of the workbench tab, just under the header action band.
 *
 * Its whole purpose is to be immune to the response panel opening. It is
 * rendered OUTSIDE the tab/split subtree, so the layout switch that shrinks
 * the request pane cannot move it — the button stays under the pointer that
 * just clicked it.
 *
 * The bar also publishes its measured width as `--restorm-action-toolbar-reserve`
 * on the owning `.restorm-workbench-tab`, so the title row reserves exactly the
 * bar's footprint (plus a small clearance) and no more — a one-disc bar and a
 * two-disc bar each get a title that truncates right at the bar's left edge
 * instead of stopping short behind a fixed, over-wide padding.
 */
export const RequestActionToolbar: React.FC<RequestActionToolbarProps> = ({
  children,
  'data-testid': dataTestId
}) => {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const bar = ref.current
    const tab = bar?.closest<HTMLElement>('.restorm-workbench-tab')
    if (!bar || !tab) return

    const publish = (): void => {
      // `offsetWidth` is 0 while the tab is display:none (inactive); the
      // ResizeObserver fires again the moment it becomes visible, so the
      // reserve is corrected before the tab is ever shown.
      const reserve = bar.offsetWidth + BAR_RIGHT_INSET_PX + TITLE_CLEARANCE_PX
      tab.style.setProperty('--restorm-action-toolbar-reserve', `${reserve}px`)
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(bar)
    return () => {
      observer.disconnect()
      tab.style.removeProperty('--restorm-action-toolbar-reserve')
    }
  }, [])

  return (
    <div
      ref={ref}
      className="restorm-request-action-toolbar"
      {...(dataTestId ? { 'data-testid': dataTestId } : { 'data-testid': 'request-action-toolbar' })}
    >
      {children}
    </div>
  )
}

export default RequestActionToolbar
