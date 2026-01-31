import React from 'react'
import './callout.css'

export type CalloutVariant = 'info' | 'warning' | 'error' | 'debug'

export interface CalloutProps {
  /** The variant/style of the callout */
  variant: CalloutVariant
  /** The message to display */
  message: string
  /** Optional test id for stable E2E selectors */
  'data-testid'?: string
  /** Optional custom icon (codicon name without 'codicon-' prefix). Defaults based on variant. */
  icon?: string
  /** Optional className for additional styling */
  className?: string
}

const defaultIcons: Record<CalloutVariant, string> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  debug: 'bug'
}

/**
 * Callout component for displaying status messages with different severity levels.
 * Supports info, warning, error, and debug variants.
 */
export const Callout: React.FC<CalloutProps> = ({
  variant,
  message,
  'data-testid': dataTestId,
  icon,
  className
}) => {
  const iconName = icon ?? defaultIcons[variant]

  return (
    <div
      className={`ecu-callout ecu-callout-${variant} ${className ?? ''}`}
      data-variant={variant}
      data-icon={iconName}
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      <i className={`codicon codicon-${iconName}`} />
      <span className="ecu-callout-message">{message}</span>
    </div>
  )
}
