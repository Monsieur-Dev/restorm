import React from 'react'
import './readOnlyOverlay.css'

export interface ReadOnlyOverlayProps {
  children: React.ReactNode
  'data-testid'?: string
}

/**
 * Renders `children` — the host's normal, fully-interactive entity panel,
 * UNMODIFIED — with every form control inside it made non-interactive via
 * CSS alone (`pointer-events: none` scoped to input/textarea/select/button/
 * [role="button"]/[contenteditable]` descendants, not the container
 * itself). This is how the conflict-resolution user/server panels satisfy
 * "EXACTLY the normal entity panel, read-only" without a bespoke
 * `readOnly` prop threaded through every protocol's field components:
 * the SAME component renders, pixel-identical, just inert. Scrolling and
 * text selection inside the panel keep working since the container is
 * untouched — only the leaf controls are disabled.
 *
 * Not a substitute for a real `readOnly` prop where one already exists
 * (prefer that when available — it's more explicit); this exists for the
 * majority of entity panels that have no such prop today.
 */
export const ReadOnlyOverlay: React.FC<ReadOnlyOverlayProps> = ({ children, 'data-testid': dataTestId }) => {
  return (
    <div className="ecui-read-only-overlay" data-testid={dataTestId}>
      {children}
    </div>
  )
}

export default ReadOnlyOverlay
