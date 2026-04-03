function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function tabsRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function tabsTabTestId(tabsTestId: string, tabId: string): string {
  return `${tabsTestId}-tab-${tabId}`
}

export function tabsTabSelector(tabsTestId: string, tabId: string): string {
  return `[data-testid="${escapeAttributeValue(tabsTabTestId(tabsTestId, tabId))}"]`
}

export function tabsTabPanelTestId(tabsTestId: string, tabId: string): string {
  return `${tabsTestId}-tabpanel-${tabId}`
}

export function tabsTabPanelSelector(tabsTestId: string, tabId: string): string {
  return `[data-testid="${escapeAttributeValue(tabsTabPanelTestId(tabsTestId, tabId))}"]`
}
