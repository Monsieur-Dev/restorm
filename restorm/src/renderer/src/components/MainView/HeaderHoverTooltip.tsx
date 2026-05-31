import React, { useRef, useState } from 'react'
import { Tooltip } from 'electron-core-ui/renderer'

export interface HeaderHoverTooltipProps {
  /** Tooltip text shown on hover. */
  label: string
  /** When true, the tooltip is suppressed (e.g. while the trigger's own
   * click-popover is open, so the two overlays never stack). */
  suppressed?: boolean
  'data-testid'?: string
  children: React.ReactNode
}

/**
 * Wraps a header action button with an ECUI `Tooltip` shown on hover —
 * the styled in-app info-bulle, not the browser's native `title`. The
 * wrapper owns the hover state + the anchor ref the Tooltip points at.
 */
export const HeaderHoverTooltip: React.FC<HeaderHoverTooltipProps> = ({
  label,
  suppressed = false,
  'data-testid': dataTestId,
  children
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  return (
    <span
      ref={anchorRef}
      className="header-hover-tooltip"
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
    >
      {children}
      <Tooltip
        targetRef={anchorRef}
        show={hover && !suppressed}
        placement="below"
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
        content={<span className="header-hover-tooltip-label">{label}</span>}
      />
    </span>
  )
}

export default HeaderHoverTooltip
