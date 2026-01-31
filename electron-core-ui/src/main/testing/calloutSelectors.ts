function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function calloutTestIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function calloutMessageSelector(testId: string): string {
  return `${calloutTestIdSelector(testId)} .ecu-callout-message`
}

export function calloutIconSelector(testId: string): string {
  return `${calloutTestIdSelector(testId)} .codicon`
}
