/**
 * ControlGroup — groups multiple controls into a single joined strip.
 *
 * Removes internal margins, border-radius, and borders between adjacent children
 * so they appear as one continuous control. Adds thin internal borders between items.
 * Stretches shorter children to match the tallest.
 *
 * @example
 * ```tsx
 * import { ControlGroup } from 'electron-core-ui/renderer'
 *
 * <ControlGroup>
 *   <SelectBox ... />
 *   <InputBox ... />
 *   <Button ... />
 * </ControlGroup>
 * ```
 */

import React from 'react'
import './controlGroup.css'

export type ControlGroupOrientation = 'horizontal' | 'vertical'

export interface ControlGroupProps {
  /** Layout direction (defaults to 'horizontal') */
  orientation?: ControlGroupOrientation
  /** Child components to join together */
  children: React.ReactNode
  /** Additional CSS class */
  className?: string
  /** Test ID */
  'data-testid'?: string
}

export const ControlGroup: React.FC<ControlGroupProps> = ({
  orientation = 'horizontal',
  children,
  className = '',
  'data-testid': testId
}) => {
  const classes = [
    'ecu-control-group',
    `ecu-control-group--${orientation}`,
    className
  ].filter(Boolean).join(' ')

  return (
    <div
      className={classes}
      {...(testId && { 'data-testid': testId })}
    >
      {children}
    </div>
  )
}
