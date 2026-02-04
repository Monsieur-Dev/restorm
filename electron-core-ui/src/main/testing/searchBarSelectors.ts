import { inputBoxInputSelector } from './inputBoxSelectors'

function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function searchBarRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function searchBarClosedSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-closed"]`
}

export function searchBarOpenSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-open"]`
}

export function searchBarInputBoxTestId(testId: string): string {
  return `${testId}-inputbox`
}

export function searchBarInputBoxSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(searchBarInputBoxTestId(testId))}"]`
}

export function searchBarInputSelector(testId: string): string {
  return inputBoxInputSelector(searchBarInputBoxTestId(testId))
}

export function searchBarScrollableTestId(testId: string): string {
  return `${testId}-scrollable`
}

export function searchBarResultsSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-results"]`
}

export function searchBarCategorySelector(testId: string, categoryKey: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-category-${escapeAttributeValue(categoryKey)}"]`
}

export function searchBarResultSelector(testId: string, resultKey: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-result-${escapeAttributeValue(resultKey)}"]`
}

export function searchBarTooltipSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-tooltip"]`
}

export function searchBarTooltipMarkdownSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-tooltip-markdown"]`
}

// EOF
