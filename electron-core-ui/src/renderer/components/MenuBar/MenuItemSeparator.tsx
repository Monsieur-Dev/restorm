import React from 'react'
import { MenuItemSeparatorProps } from './types'

const MenuItemSeparator: React.FC<MenuItemSeparatorProps> = ({
  className = '',
  id,
  'data-testid': dataTestId
}) => {
  return (
    <li 
      id={id}
      className={`action-item separator ${className}`.trim()}
      role="presentation"
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      <div
        className="action-menu-item separator"
        role="separator"
        {...(dataTestId && { 'data-testid': `${dataTestId}-separator` })}
      />
    </li>
  )
}

// Stable identity for the native-menu template walker, which matches
// nodes by displayName rather than importing the components (avoids a
// renderer import cycle). Also improves React DevTools output.
MenuItemSeparator.displayName = 'MenuItemSeparator'

export { MenuItemSeparator }
