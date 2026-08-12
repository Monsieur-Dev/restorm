import React, { useRef, useState } from 'react'
import { Tooltip } from 'electron-core-ui/renderer'

export interface HeaderHoverTooltipProps {
  /** Tooltip text shown on hover. */
  label: string
  /** When true, the tooltip is suppressed (e.g. while the trigger's own
   * click-popover is open, so the two overlays never stack). */
  suppressed?: boolean
  /** Extra class on the anchor span — lets a caller restyle the inline-flex
   * wrapper (e.g. stretch it to wrap a full-width control group). */
  className?: string
  /** Vertical placement of the tooltip relative to the anchor (default below).
   * Use 'above' to keep it clear of a sibling tooltip rendered below. */
  placement?: 'auto' | 'above' | 'below'
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
  className,
  placement = 'below',
  'data-testid': dataTestId,
  children
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  return (
    <span
      ref={anchorRef}
      className={className ? `header-hover-tooltip ${className}` : 'header-hover-tooltip'}
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
    >
      {children}
      <Tooltip
        targetRef={anchorRef}
        show={hover && !suppressed}
        placement={placement}
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
        content={<span className="header-hover-tooltip-label" style={{ whiteSpace: 'pre-line' }}>{label}</span>}
      />
    </span>
  )
}
