export function editorWorkbenchRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function editorWorkbenchGroupSelector(testId: string, groupId: string): string {
  return `[data-testid="${testId}-group-${groupId}"]`
}

export function editorWorkbenchGroupContentSelector(testId: string, groupId: string): string {
  return `[data-testid="${testId}-group-${groupId}-content"]`
}

export function editorWorkbenchGroupTabsSelector(testId: string, groupId: string): string {
  return `[data-testid="${testId}-group-${groupId}-tabs"]`
}

export function editorWorkbenchGroupTabsContainerSelector(testId: string, groupId: string): string {
  return `[data-testid="${testId}-group-${groupId}-tabs-container"]`
}

export function editorWorkbenchTabSelector(testId: string, groupId: string, tabId: string): string {
  return `[data-testid="${testId}-group-${groupId}-tabs-tab-${tabId}"]`
}

export function editorWorkbenchTabLabelSelector(testId: string, groupId: string, tabId: string): string {
  return `[data-testid="${testId}-group-${groupId}-tabs-tab-${tabId}-label"]`
}

export function editorWorkbenchTabCloseSelector(testId: string, groupId: string, tabId: string): string {
  return `[data-testid="${testId}-group-${groupId}-tabs-tab-${tabId}-close"]`
}

export function editorWorkbenchGroupTabsContextMenuSelector(testId: string, groupId: string): string {
  return `[data-testid="${testId}-group-${groupId}-tabs-contextmenu"]`
}

export function editorWorkbenchSashSelector(testId: string, nodeId: string, index: number): string {
  return `[data-testid="${testId}-sash-${nodeId}-${index}"]`
}
