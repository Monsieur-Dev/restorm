function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapePlaywrightText(value: string): string {
  // For Playwright `:has-text("...")` selectors.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function splitViewRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

/**
 * A pane's own generated testid embeds a POSITIONAL index
 * (`splitViewPaneSelector`'s `paneIdOrIndex`), which shifts whenever a
 * sibling pane is conditionally shown/hidden (e.g. a master list pane
 * that only renders once there's more than one item to list) — a host
 * whose pane count varies at runtime can't reliably address "the pane
 * titled X" by index. This locates a pane by its rendered HEADER TEXT
 * instead, scoped to the given SplitView root so it never matches an
 * unrelated SplitView elsewhere on the page.
 */
export function splitViewPaneSelectorByHeaderTitle(splitViewTestId: string, title: string): string {
  const root = splitViewRootSelector(splitViewTestId)
  return `${root} .split-view-view:has(.split-view-view-header-title:has-text("${escapePlaywrightText(title)}"))`
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
