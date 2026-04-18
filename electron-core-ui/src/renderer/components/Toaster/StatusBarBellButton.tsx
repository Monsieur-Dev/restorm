import React, { useCallback } from 'react'
import StatusbarElement from '../Statusbar/StatusbarElement'
import { toasterService } from './ToasterService'
import { useToasts } from './useToasts'

export interface StatusBarBellButtonProps {
  /** Id of the `<Toaster>` instance this bell should toggle. */
  toasterId: string
  /** CSS class forwarded to the underlying `<StatusbarElement>` (e.g. `'right-aligned'`). */
  className?: string
  /** Test id root for the bell button. Defaults to `statusbar-toaster-bell`. */
  'data-testid'?: string
  /** Accessible label for the button. Defaults to `Toggle notifications`. */
  ariaLabel?: string
}

/**
 * Statusbar cell that toggles a `<Toaster>` visibility via the shared
 * `toasterService`. Renders a `codicon-bell` glyph; overlays a small
 * red badge at the bottom-right when at least one stored toast has
 * `seen === false`.
 *
 * Place inside a `<Statusbar>` like any other `<StatusbarElement>`.
 */
export const StatusBarBellButton: React.FC<StatusBarBellButtonProps> = ({
  toasterId,
  className,
  'data-testid': dataTestId = 'statusbar-toaster-bell',
  ariaLabel = 'Toggle notifications'
}) => {
  const { toasts } = useToasts(toasterId)
  const hasUnseen = toasts.some((toast) => !toast.seen)

  const handleClick = useCallback(() => {
    toasterService.toggleVisibility(toasterId)
  }, [toasterId])

  const badgeTestId = `${dataTestId}-badge`

  const elementProps: {
    title: React.ReactNode
    onClick: () => void
    'data-testid': string
    className?: string
  } = {
    title: (
      <span
        aria-label={ariaLabel}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      >
        <i className="codicon codicon-bell"></i>
        {hasUnseen && (
          <span
            data-testid={badgeTestId}
            aria-label="Unseen notifications"
            style={{
              position: 'absolute',
              right: 1,
              bottom: -1,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--notificationsErrorIcon-foreground, #e74c3c)',
              boxShadow: '0 0 0 1px var(--statusBar-background, transparent)',
              pointerEvents: 'none'
            }}
          />
        )}
      </span>
    ),
    onClick: handleClick,
    'data-testid': dataTestId
  }
  if (className !== undefined) elementProps.className = className

  return <StatusbarElement {...elementProps} />
}
