import React from 'react'
import { MenuItemSeparatorProps } from './types'

const MenuItemSeparator: React.FC<MenuItemSeparatorProps> = ({
  className = '',
  id
}) => {
  return (
    <li 
      id={id}
      className={`action-item separator ${className}`.trim()}
      role="presentation"
    >
      <div className="action-menu-item separator" role="separator" />
    </li>
  )
}

export default MenuItemSeparator

