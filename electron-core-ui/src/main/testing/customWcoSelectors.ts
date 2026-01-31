function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function customWcoRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function customWcoSpacerSelector(testId: string): string {
  return customWcoRootSelector(testId)
}

export function customWcoMinimizeSelector(testId: string): string {
  return customWcoRootSelector(`${testId}-minimize`)
}

export function customWcoMaximizeSelector(testId: string): string {
  return customWcoRootSelector(`${testId}-maximize`)
}

export function customWcoCloseSelector(testId: string): string {
  return customWcoRootSelector(`${testId}-close`)
}

export function customWcoMaximizeIconSelector(testId: string, icon: 'chrome-maximize' | 'chrome-restore'): string {
  return `${customWcoMaximizeSelector(testId)} .codicon-${escapeAttributeValue(icon)}`
}
