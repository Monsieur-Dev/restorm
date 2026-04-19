import React from 'react'
import type { Icon } from '../../../types/icon'

export interface StatusbarProps {
  children?: React.ReactNode
  className?: string
  id?: string
  'data-testid'?: string
}

export interface StatusbarElementProps {
  /**
   * Optional label rendered to the right of the icon. Accepts a plain
   * string or any ReactNode for consumers that need custom markup.
   */
  title?: string | React.ReactNode
  /**
   * Optional icon rendered at the left edge of the cell via `IconView`
   * — supports codicons, emojis and library icons. Sized to 16 px
   * (matching the bar's default glyph weight) and centered by the
   * cell's flex layout, so consumers don't need to wrap it or tweak
   * `transform`/`line-height` themselves.
   */
  icon?: Icon | null
  /**
   * Optional custom background color (e.g. environment swatch). When
   * set, the cell also recomputes its foreground color via
   * `getContrastColor` so label + icon stay legible on any hue.
   */
  backgroundColor?: string
  warning?: boolean
  error?: boolean
  /** Dim the cell to signal a non-actionable state (adds ~50 % opacity). */
  disabled?: boolean
  /**
   * Optional ReactNode rendered on top of the cell (absolutely
   * positioned via the caller's inline style) — e.g. an unread-badge
   * dot on the notification bell. The cell itself is
   * `position: relative` so the overlay positions against it.
   */
  overlay?: React.ReactNode
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  className?: string
  id?: string
  /**
   * Tooltip content. Rendered inside a `<Tooltip>` portal anchored to
   * the cell. Set `tooltipTrigger` to control whether the tooltip
   * opens on hover (default, info-style) or on click (popover-style,
   * for cells that need interactive content like the env picker).
   */
  children?: React.ReactNode
  /**
   * How the tooltip / popover attached via `children` opens.
   * - `'hover'` (default): 300 ms hover-open, small leave-close delay.
   * - `'click'`: toggles on cell click, closes on outside click /
   *   Escape. The cell's own `onClick` handler (if any) still fires —
   *   wire it up to side-effects other than visibility.
   */
  tooltipTrigger?: 'hover' | 'click'
  /** Forwarded to the underlying `<Tooltip>` — see `TooltipProps.placement`. */
  tooltipPlacement?: 'auto' | 'above' | 'below'
  'data-testid'?: string
}
