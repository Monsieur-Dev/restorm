function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function testIdSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function titlebarRootSelector(testId: string): string {
  return testIdSelector(testId)
}

export function titlebarLeftSelector(testId: string): string {
  return testIdSelector(`${testId}-left`)
}

export function titlebarCenterSelector(testId: string): string {
  return testIdSelector(`${testId}-center`)
}

export function titlebarRightSelector(testId: string): string {
  return testIdSelector(`${testId}-right`)
}

export function titlebarIconSelector(testId: string): string {
  return testIdSelector(`${testId}-icon`)
}

export function titlebarTitleSelector(testId: string): string {
  return testIdSelector(`${testId}-title`)
}

export function titlebarSearchBarTestId(testId: string): string {
  return `${testId}-searchbar`
}

export function titlebarCustomWcoTestId(testId: string): string {
  return `${testId}-customwco`
}
