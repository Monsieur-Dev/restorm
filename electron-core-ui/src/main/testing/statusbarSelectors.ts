function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function statusbarRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function statusbarElementSelector(elementTestId: string): string {
  return `[data-testid="${escapeAttributeValue(elementTestId)}"]`
}

export function statusbarElementLabelSelector(elementTestId: string): string {
  return `[data-testid="${escapeAttributeValue(elementTestId)}-label"]`
}

export function statusbarElementTooltipSelector(elementTestId: string): string {
  return `[data-testid="${escapeAttributeValue(elementTestId)}-tooltip"]`
}
