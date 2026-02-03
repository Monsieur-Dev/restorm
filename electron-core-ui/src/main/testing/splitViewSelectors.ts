function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function splitViewRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function splitViewPaneTestId(splitViewTestId: string, paneIdOrIndex: string): string {
  return `${splitViewTestId}-pane-${paneIdOrIndex}`
}

export function splitViewPaneSelector(splitViewTestId: string, paneIdOrIndex: string): string {
  const paneTestId = splitViewPaneTestId(splitViewTestId, paneIdOrIndex)
  return `[data-testid="${escapeAttributeValue(paneTestId)}"]`
}

export function splitViewPaneHeaderSelector(splitViewTestId: string, paneIdOrIndex: string): string {
  const paneTestId = splitViewPaneTestId(splitViewTestId, paneIdOrIndex)
  return `[data-testid="${escapeAttributeValue(paneTestId)}-header"]`
}

export function splitViewPaneBodySelector(splitViewTestId: string, paneIdOrIndex: string): string {
  const paneTestId = splitViewPaneTestId(splitViewTestId, paneIdOrIndex)
  return `[data-testid="${escapeAttributeValue(paneTestId)}-body"]`
}

export function splitViewSashTestId(splitViewTestId: string, index: number): string {
  return `${splitViewTestId}-sash-${index}`
}

export function splitViewSashSelector(splitViewTestId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(splitViewSashTestId(splitViewTestId, index))}"]`
}
