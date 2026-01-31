function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function tooltipRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function tooltipContentSelector(testId: string): string {
  return `${tooltipRootSelector(testId)} .tooltip-content`
}
