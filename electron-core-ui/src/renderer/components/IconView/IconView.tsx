import React, { memo } from 'react'
import type { Icon } from '../../../types/icon'
import { RenderLibraryIcon } from '../IconSelect/iconLibraries'

import './iconView.css'

export interface IconViewProps {
  /** The icon to display */
  icon: Icon | null | undefined
  /** Size in pixels (default: 16) */
  size?: number
  /** Additional CSS class */
  className?: string
  /** Optional test id */
  'data-testid'?: string
}

/**
 * Renders any Icon type (codicon, emoji, or library icons like material, feather, etc.).
 * Use this component whenever you need to display an icon from the Icon type
 * without the full picker UI of IconSelect.
 */
const IconViewInner: React.FC<IconViewProps> = ({
  icon,
  size = 16,
  className,
  'data-testid': dataTestId
}) => {
  if (!icon || icon.type === 'none') return null

  const rootClass = ['ecui-icon-view', className].filter(Boolean).join(' ')

  if (icon.type === 'emoji') {
    return (
      <span
        className={rootClass}
        style={{ fontSize: size }}
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
      >
        {icon.value}
      </span>
    )
  }

  if (icon.type === 'codicon') {
    return (
      <i
        className={`${rootClass} codicon codicon-${icon.value}`}
        style={{ fontSize: size }}
        aria-hidden="true"
        {...(dataTestId ? { 'data-testid': dataTestId } : {})}
      />
    )
  }

  // Library icons (iconoir, phosphor, material, simpleicons, feather, fontawesome)
  return (
    <span
      className={rootClass}
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    >
      <RenderLibraryIcon type={icon.type} name={icon.value} size={size} />
    </span>
  )
}

export const IconView = memo(IconViewInner)
IconView.displayName = 'IconView'

export default IconView
