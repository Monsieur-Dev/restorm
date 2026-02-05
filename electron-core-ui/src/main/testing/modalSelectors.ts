function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function testIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function modalRootSelector(testId: string): string {
  return testIdSelector(testId)
}

export function modalOverlaySelector(testId: string): string {
  return testIdSelector(`${testId}-overlay`)
}

export function modalHeaderSelector(testId: string): string {
  return testIdSelector(`${testId}-header`)
}

export function modalTitleSelector(testId: string): string {
  return testIdSelector(`${testId}-title`)
}

export function modalBodySelector(testId: string): string {
  return testIdSelector(`${testId}-body`)
}

export function modalCloseButtonTestId(testId: string): string {
  return `${testId}-close`
}

export function modalCloseButtonSelector(testId: string): string {
  return testIdSelector(modalCloseButtonTestId(testId))
}
