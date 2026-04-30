function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function menuBarRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function menuBarMenuButtonSelector(menuId: string): string {
  return `[data-testid="${escapeAttributeValue(menuId)}"]`
}

export function menuBarMenuTitleSelector(menuId: string): string {
  return `[data-testid="${escapeAttributeValue(menuId)}-title"]`
}

export function menuBarMenuDropdownSelector(menuId: string): string {
  return `[data-testid="${escapeAttributeValue(menuId)}-menu"]`
}

export function menuBarMenuScrollableSelector(menuId: string): string {
  return `[data-testid="${escapeAttributeValue(menuId)}-scrollable"]`
}

export function menuBarItemSelector(itemId: string): string {
  return `[data-testid="${escapeAttributeValue(itemId)}"]`
}

export function menuBarItemLabelSelector(itemId: string): string {
  return `[data-testid="${escapeAttributeValue(itemId)}-label"]`
}

export function menuBarItemShortcutSelector(itemId: string): string {
  return `[data-testid="${escapeAttributeValue(itemId)}-shortcut"]`
}

export function menuBarItemSubmenuSelector(itemId: string): string {
  return `[data-testid="${escapeAttributeValue(itemId)}-submenu"]`
}

export function menuBarItemSubmenuScrollableSelector(itemId: string): string {
  return `[data-testid="${escapeAttributeValue(itemId)}-submenu-scrollable"]`
}

/** Trailing "..." button when the responsive `MenuBar` is in `overflow` mode. */
export function menuBarOverflowButtonSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-overflow-button"]`
}

/** Single hamburger "☰" button when the responsive `MenuBar` is in `hamburger` mode. */
export function menuBarHamburgerButtonSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-hamburger-button"]`
}
