import React from 'react'
import './readOnlyOverlay.css'

export interface ReadOnlyOverlayProps {
  children: React.ReactNode
  'data-testid'?: string
}

/**
 * Renders `children` — the host's normal, fully-interactive entity panel,
 * UNMODIFIED — made non-interactive by the DOM `inert` attribute on the
 * wrapper. `inert` takes the whole subtree out of the tab order and blocks
 * focus, typing, clicks and pointer events, so the panel can't be mutated
 * by mouse OR keyboard (`pointer-events: none` alone left the controls
 * keyboard-focusable and typeable). Wheel/trackpad scrolling still works —
 * `inert` doesn't gate scrolling — so a tall panel stays browsable; only
 * text selection and interaction are intentionally off, which is the point
 * for a static conflict snapshot. This is how the conflict-resolution
 * user/server panels satisfy "EXACTLY the normal entity panel, read-only"
 * without a bespoke `readOnly` prop threaded through every protocol's field
 * components: the SAME component renders, pixel-identical, just inert.
 *
 * The scoped `pointer-events: none` CSS is kept as a defensive fallback for
 * any environment that doesn't honour `inert`.
 *
 * Not a substitute for a real `readOnly` prop where one already exists
 * (prefer that when available — it's more explicit); this exists for the
 * majority of entity panels that have no such prop today.
 */
export const ReadOnlyOverlay: React.FC<ReadOnlyOverlayProps> = ({ children, 'data-testid': dataTestId }) => {
  return (
    <div className="ecui-read-only-overlay" inert data-testid={dataTestId}>
      {children}
    </div>
  )
}

export default ReadOnlyOverlay
