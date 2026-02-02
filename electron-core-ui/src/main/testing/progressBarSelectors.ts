export function progressBarRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function progressBarBitSelector(testId: string): string {
  return `[data-testid="${testId}-bit"]`
}
