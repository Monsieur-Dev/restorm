import { buttonAnchorSelector } from './buttonSelectors'

function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function listViewDropdownRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function listViewDropdownButtonTestId(testId: string): string {
  return `${testId}-button`
}

export function listViewDropdownButtonAnchorSelector(testId: string): string {
  return buttonAnchorSelector(listViewDropdownButtonTestId(testId))
}

export function listViewDropdownPanelSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-panel"]`
}

export function listViewDropdownScrollableTestId(testId: string): string {
  return `${testId}-scrollable`
}

export function listViewDropdownScrollableSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(listViewDropdownScrollableTestId(testId))}"]`
}

export function listViewDropdownListViewTestId(testId: string): string {
  return `${testId}-listview`
}
