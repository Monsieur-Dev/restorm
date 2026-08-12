import React, { useEffect, useRef, useState } from 'react'
import { ScrollableElement, Tooltip } from 'electron-core-ui/renderer'

export interface ScenarioTruncatedTextProps {
  /** The text shown in the row. It is ellipsis-clipped by CSS at whatever
   * width the row currently has, so widening the panel reveals more of it. */
  text: string
  /** The untruncated text for the tooltip. Defaults to `text` — supply it when
   * the row label itself is a clipped rendering of a longer value. */
  full?: string
  /** Rendered before the text on the same line, outside the clipped span (e.g.
   * a log entry's timestamp, which must never be the part that disappears). */
  before?: React.ReactNode
}

/**
 * A one-line label that clips with an ellipsis at the available width and,
 * when (and only when) it is actually clipped, reveals the whole value in an
 * ECUI `Tooltip` on hover — never the browser's native `title`.
 *
 * Truncation is tracked with a `ResizeObserver` rather than a one-off measure:
 * the observer fires on mount AND on every layout change, so resizing the
 * inspector re-evaluates whether the row still needs a tooltip.
 *
 * The tooltip is **enterable**: it re-enables pointer events and bridges the
 * hover (a short close delay), so the pointer can move from the row into it.
 * That is what makes a value taller than the tooltip's height cap readable —
 * it scrolls, in an ECUI `ScrollableElement`. Without that the tail of a long
 * value would be clipped a second time, with no way to reach it.
 *
 * Used for the scenario run-log rows and for the JSON-tree value rows of the
 * inspector preview — the two places where a long value would otherwise be
 * unreadable.
 */
export const ScenarioTruncatedText: React.FC<ScenarioTruncatedTextProps> = ({ text, full, before }) => {
  const textRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = textRef.current
    if (!el) return
    const check = (): void => { setTruncated(el.scrollWidth > el.clientWidth) }
    check()
    const obs = new ResizeObserver(check)
    obs.observe(el)
    return () => { obs.disconnect() }
  }, []) // mount/unmount only — ResizeObserver covers layout-driven size changes

  // Re-check when the text itself changes: scrollWidth can change even when the
  // element's clientWidth (observed by ResizeObserver) stays the same.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    setTruncated(el.scrollWidth > el.clientWidth)
  }, [text])

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const open = (): void => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setHover(true)
  }
  // Close on a short delay so a pointer crossing the row's gaps doesn't make
  // the tooltip flicker.
  const scheduleClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setHover(false) }, 160)
  }

  return (
    <span className="scn-trunc-line" onMouseEnter={open} onMouseLeave={scheduleClose}>
      {before}
      <span className="scn-trunc-text" ref={textRef}>{text}</span>
      <Tooltip
        targetRef={textRef}
        show={hover && truncated}
        placement="below"
        content={
          <span className="scn-trunc-tooltip" onMouseEnter={open} onMouseLeave={scheduleClose}>
            <ScrollableElement
              options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
              className="scn-trunc-tooltip-scroll"
              data-testid="scenario-truncated-tooltip"
            >
              <span className="scn-trunc-tooltip-text">{full ?? text}</span>
            </ScrollableElement>
          </span>
        }
      />
    </span>
  )
}
