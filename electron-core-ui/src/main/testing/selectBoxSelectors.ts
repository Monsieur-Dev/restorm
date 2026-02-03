function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function selectBoxRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function selectBoxTriggerSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-trigger"]`
}

export function selectBoxDropdownSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-dropdown"]`
}

export function selectBoxScrollableSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-scrollable"]`
}

export function selectBoxListboxSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-listbox"]`
}

export function selectBoxOptionSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-option-${String(index)}"]`
}

export function selectBoxOptionLabelSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-option-${String(index)}-label"]`
}

export function selectBoxOptionDetailSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-option-${String(index)}-detail"]`
}

export function selectBoxOptionDecoratorSelector(testId: string, index: number): string {
  return `[data-testid="${escapeAttributeValue(testId)}-option-${String(index)}-decorator"]`
}

export function selectBoxDetailsSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-details"]`
}
