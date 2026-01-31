function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function breadcrumbRootSelector(breadcrumbTestId: string): string {
  return `[data-testid="${escapeAttributeValue(breadcrumbTestId)}"]`
}

export function breadcrumbLastLabelSelector(breadcrumbTestId: string): string {
  return `${breadcrumbRootSelector(breadcrumbTestId)} button[aria-current="page"]`
}

export function breadcrumbEditInputSelector(breadcrumbTestId: string): string {
  return `${breadcrumbRootSelector(breadcrumbTestId)} input.ecui-breadcrumb-input`
}

export function breadcrumbNonLastItemsSelector(breadcrumbTestId: string): string {
  return `${breadcrumbRootSelector(breadcrumbTestId)} li.ecui-breadcrumb-item:not(.ecui-breadcrumb-item--last) button.ecui-breadcrumb-link`
}
