import React from 'react'

export interface MenuBarProps {
  children: React.ReactNode
  className?: string
  id?: string
}

export interface MenuItemProps {
  title: string
  shortcut?: string
  onClick?: () => void
  checked?: boolean
  disabled?: boolean
  /**
   * Optional leading icon for the menu item.
   * When provided, it replaces the default checkmark placeholder.
   */
  icon?: React.ReactNode
  children?: React.ReactNode
  className?: string
  id?: string
}

export interface MenuItemSeparatorProps {
  className?: string
  id?: string
}

export interface MenuBarState {
  focusedMenuIndex: number | null
  isOpen: boolean
  activeMenuIndex: number | null
}

export interface MenuItemState {
  isHovered: boolean
  isFocused: boolean
}
