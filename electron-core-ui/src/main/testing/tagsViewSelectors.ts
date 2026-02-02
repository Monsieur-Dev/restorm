function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function tagsViewRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function tagsViewListSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-list"]`
}

export function tagsViewTagSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-tag-${String(index)}"]`
}

export function tagsViewTagLabelSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-tag-${String(index)}-label"]`
}

export function tagsViewTagInputSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-tag-${String(index)}-input"]`
}

export function tagsViewAddSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-add"]`
}

export function tagsViewContextMenuSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-contextmenu"]`
}
