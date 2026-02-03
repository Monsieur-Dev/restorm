function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function iconSelectRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function iconSelectButtonSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-button"]`
}

export function iconSelectPickerSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-picker"]`
}

export function iconSelectTabSelector(testId: string, tabId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-tab-${escapeAttributeValue(tabId)}"]`
}

export function iconSelectClearSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-clear"]`
}

export function iconSelectPanelSelector(testId: string, tabId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-panel-${escapeAttributeValue(tabId)}"]`
}

export function iconSelectSearchInputSelector(testId: string, tabId: string): string {
  if (tabId === 'emoji') return `[data-testid="${escapeAttributeValue(testId)}-emoji-search-input"]`
  if (tabId === 'material') return `[data-testid="${escapeAttributeValue(testId)}-material-search-input"]`
  if (tabId === 'simpleicons') return `[data-testid="${escapeAttributeValue(testId)}-simpleicons-search-input"]`
  if (tabId === 'feather') return `[data-testid="${escapeAttributeValue(testId)}-feather-search-input"]`
  return `[data-testid="${escapeAttributeValue(testId)}-${escapeAttributeValue(tabId)}-search-input"]`
}

export function iconSelectSearchClearSelector(testId: string, tabId: string): string {
  if (tabId === 'emoji') return `[data-testid="${escapeAttributeValue(testId)}-emoji-search-clear"]`
  if (tabId === 'material') return `[data-testid="${escapeAttributeValue(testId)}-material-search-clear"]`
  if (tabId === 'simpleicons') return `[data-testid="${escapeAttributeValue(testId)}-simpleicons-search-clear"]`
  if (tabId === 'feather') return `[data-testid="${escapeAttributeValue(testId)}-feather-search-clear"]`
  return `[data-testid="${escapeAttributeValue(testId)}-${escapeAttributeValue(tabId)}-search-clear"]`
}

export function iconSelectIconSelector(testId: string, tabId: string, iconName: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-${escapeAttributeValue(tabId)}-icon-${escapeAttributeValue(iconName)}"]`
}

export function iconSelectEmojiSelector(testId: string, emoji: string): string {
  return `${iconSelectPickerSelector(testId)} [data-emoji="${escapeAttributeValue(emoji)}"]`
}
