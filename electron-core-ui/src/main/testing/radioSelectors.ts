export function radioGroupRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function radioGroupItemSelector(testId: string, index: number): string {
  return `[data-testid="${testId}-item-${index}"]`
}
