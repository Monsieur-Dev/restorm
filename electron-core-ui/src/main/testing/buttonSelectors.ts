function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buttonTestIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

/**
 * Returns a selector that matches either:
 * - the element itself when it is the interactive anchor (Button)
 * - or the nested anchor for wrapper components (ButtonWithDescription / ButtonWithDropdown)
 */
export function buttonAnchorSelector(testId: string): string {
  const root = buttonTestIdSelector(testId)
  return `${root}[role="button"], ${root} a[role="button"]`
}

export function buttonDropdownToggleSelector(testId: string): string {
  return buttonTestIdSelector(`${testId}-toggle`)
}

export function buttonDropdownPrimarySelector(testId: string): string {
  return buttonTestIdSelector(`${testId}-primary`)
}

export function buttonDropdownMenuSelector(testId: string): string {
  const root = buttonTestIdSelector(testId)
  return `${root} .button-dropdown-menu, ${buttonTestIdSelector(`${testId}-menu`)}`
}

export function buttonDropdownActionByIndexSelector(testId: string, index: number): string {
  return buttonTestIdSelector(`${testId}-action-${String(index)}`)
}
