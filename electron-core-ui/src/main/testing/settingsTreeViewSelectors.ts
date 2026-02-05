function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function normalizeTestIdSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function settingsTreeViewRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function settingsTreeViewItemTestId(settingsTreeViewTestId: string, categoryId: string): string {
  return `${settingsTreeViewTestId}-item-${normalizeTestIdSegment(categoryId)}`
}

export function settingsTreeViewItemSelector(settingsTreeViewTestId: string, categoryId: string): string {
  return `[data-testid="${escapeAttributeValue(settingsTreeViewItemTestId(settingsTreeViewTestId, categoryId))}"]`
}
