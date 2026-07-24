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
  /**
   * Native menu role for this item (`'undo' | 'copy' | 'paste' | …`), used
   * only where the host renders menus natively — macOS puts them in the
   * system bar. Declaring the role lets the platform perform the action
   * itself on the focused element, which is the only thing that makes
   * ⌘C/⌘V/⌘Z work in text fields; routing those through an app handler
   * does not reliably reach native fields, Monaco or webviews.
   *
   * The role also owns the item's enabled state, so an item carrying one
   * ignores `disabled` in the native menu: the platform enables it exactly
   * when it applies. Left undefined, the item is a plain action.
   *
   * NOTE: despite the name, this is NOT the ARIA role and must never reach the
   * DOM — the rendered anchor hardcodes `role="menuitem"`. This prop is read
   * only when walking the tree into a native menu template, so keep `MenuItem`
   * destructuring its props explicitly; adding a `{...rest}` spread would leak
   * it onto the element and override the accessible role.
   */
  role?: string
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
