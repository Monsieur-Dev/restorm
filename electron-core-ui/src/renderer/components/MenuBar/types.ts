import React from 'react'

export interface MenuBarProps {
  children: React.ReactNode
  className?: string
  id?: string
  /**
   * Below this container width (in CSS pixels), the menubar collapses
   * every top-level menu into a single hamburger (`☰`) button. Above
   * it, items that don't fit collapse into a trailing overflow
   * (`...`) button instead. Defaults to 200 px.
   */
  hamburgerBelowPx?: number
  'data-testid'?: string
}

/** Layout mode the responsive MenuBar can be in. */
export type MenuBarLayoutMode = 'full' | 'overflow' | 'hamburger'

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
  'data-testid'?: string
}

export interface MenuItemSeparatorProps {
  className?: string
  id?: string
  'data-testid'?: string
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
