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

export default MenuItemSeparator
