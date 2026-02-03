function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function listViewRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function listViewScrollableTestId(listViewTestId: string): string {
  return `${listViewTestId}-scrollable`
}

export function listViewScrollableContentSelector(listViewTestId: string): string {
  const scrollableTestId = listViewScrollableTestId(listViewTestId)
  return `[data-testid="${escapeAttributeValue(scrollableTestId)}-content"]`
}

export function listViewContextMenuTestId(listViewTestId: string): string {
  return `${listViewTestId}-contextmenu`
}

export function listViewRowSelectorByItemId(listViewTestId: string, itemId: string): string {
  const root = listViewRootSelector(listViewTestId)
  return `${root} .list-view-row[data-item-id="${escapeAttributeValue(itemId)}"]`
}

export function listViewRowExpanderSelectorByItemId(listViewTestId: string, itemId: string): string {
  return `${listViewRowSelectorByItemId(listViewTestId, itemId)} button.list-view-expander`
}

export function listViewRowTitleSelectorByItemId(listViewTestId: string, itemId: string): string {
  return `${listViewRowSelectorByItemId(listViewTestId, itemId)} .list-view-title`
}

export function listViewRenameInputSelector(listViewTestId: string, itemId?: string): string {
  const base = `[data-testid="${escapeAttributeValue(listViewTestId)}-rename-input"]`
  if (typeof itemId === 'string') {
    return `${base}[data-item-id="${escapeAttributeValue(itemId)}"]`
  }
  return base
}
