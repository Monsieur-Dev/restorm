function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function inputBoxRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function inputBoxContainerSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-container"]`
}

export function inputBoxInputSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-input"]`
}

export function inputBoxMessageSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-message"]`
}

export function inputBoxMirrorSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-mirror"]`
}
