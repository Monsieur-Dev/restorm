export function toggleRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function toggleActionSelector(testId: string): string {
  return `[data-testid="${testId}-action"]`
}

export function toggleLabelSelector(testId: string): string {
  return `[data-testid="${testId}-label"]`
}

export function toggleIconSelector(testId: string): string {
  return `[data-testid="${testId}-icon"]`
}
