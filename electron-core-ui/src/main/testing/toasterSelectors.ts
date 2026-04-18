function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function toasterRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function toasterHeaderSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-header"]`
}

export function toasterClearButtonSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-clear"]`
}

export function toasterDndButtonSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-dnd"]`
}

export function toasterHideButtonSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-hide"]`
}

export function toasterEmptyLabelSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-empty-label"]`
}

/** Matches any toast rendered inside the named toaster. */
export function toastSelector(testId: string): string {
  return `${toasterRootSelector(testId)} [data-toast-id]`
}

/** Matches a toast inside the named toaster by its visible title. */
export function toastByTitleSelector(testId: string, title: string): string {
  return `${toasterRootSelector(testId)} [data-toast-title="${escapeAttributeValue(title)}"]`
}

/** Matches the close button inside a specific toast (by title). */
export function toastCloseByTitleSelector(testId: string, title: string): string {
  return `${toastByTitleSelector(testId, title)} .toast-close`
}
