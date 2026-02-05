function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function settingsModalRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function settingsPageRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function settingsPageThemeCarouselTestId(settingsPageTestId: string): string {
  return `${settingsPageTestId}-theme-carousel`
}

export function settingsPageLanguageSelectBoxTestId(settingsPageTestId: string): string {
  return `${settingsPageTestId}-language-selectbox`
}

export function themeCarouselRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function themeCarouselScrollableTestId(themeCarouselTestId: string): string {
  return `${themeCarouselTestId}-scrollable`
}
