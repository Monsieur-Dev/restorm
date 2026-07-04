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
  /**
   * When true, the rendered title gets a trailing horizontal ellipsis
   * (`…`) appended — the standard UX convention for "this menu item
   * opens a dialog / window". Translations stay clean (no embedded
   * `...`); the ellipsis is a render-time concern. Defaults to `false`.
   */
  opensDialog?: boolean
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
  /**
   * Roving-tabindex anchor: the single top-level item that is a `Tab` stop
   * when nothing inside the bar currently has keyboard focus. Starts at the
   * first item and tracks whichever item was last focused/opened (mouse or
   * keyboard), per the standard ARIA menubar roving-tabindex pattern — the
   * other items always carry `tabIndex={-1}`.
   */
  tabStopIndex: number
}

export interface MenuItemState {
  isHovered: boolean
  isFocused: boolean
}
