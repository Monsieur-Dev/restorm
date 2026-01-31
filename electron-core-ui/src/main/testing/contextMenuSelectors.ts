function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeForHasText(value: string): string {
  // For Playwright's :has-text("...") selector.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function contextMenuRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function contextMenuMenuSelector(testId: string): string {
  return `${contextMenuRootSelector(testId)} [role="menu"]`
}

export function contextMenuSeparatorSelector(testId: string): string {
  return `${contextMenuRootSelector(testId)} [role="separator"]`
}

export function contextMenuItemSelectorByLabel(testId: string, label: string): string {
  const root = contextMenuRootSelector(testId)
  return `${root} a[role="menuitem"]:has-text("${escapeForHasText(label)}")`
}

export function contextMenuItemIconSelector(testId: string, label: string, icon: string): string {
  const item = contextMenuItemSelectorByLabel(testId, label)
  return `${item} .codicon-${escapeAttributeValue(icon)}`
}

export function contextMenuSubmenuIndicatorSelector(testId: string, label: string): string {
  const item = contextMenuItemSelectorByLabel(testId, label)
  return `${item} .codicon-chevron-right`
}

export function contextMenuOpenSubmenuItemSelector(testId: string, label: string): string {
  // When a submenu is open, the parent menuitem has aria-expanded="true".
  const root = contextMenuRootSelector(testId)
  return `${root} a[role="menuitem"][aria-expanded="true"]:has-text("${escapeForHasText(label)}")`
}

export function contextMenuOpenSubmenuContainerSelector(testId: string, label: string): string {
  const root = contextMenuRootSelector(testId)
  // Submenu container is rendered inside the same `<li>` as the parent item.
  return `${root} li.submenu-item:has(a[role="menuitem"]:has-text("${escapeForHasText(label)}")) div.menu-container`
}

export function contextMenuOpenSubmenuItemByLabelSelector(testId: string, parentLabel: string, childLabel: string): string {
  const submenuContainer = contextMenuOpenSubmenuContainerSelector(testId, parentLabel)
  return `${submenuContainer} a[role="menuitem"]:has-text("${escapeForHasText(childLabel)}")`
}
