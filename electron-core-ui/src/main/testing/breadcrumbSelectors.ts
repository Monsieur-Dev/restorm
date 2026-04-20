function escapeAttributeValue(value: string): string {
  // Minimal escaping for attribute selectors: keep it predictable for test ids.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function breadcrumbRootSelector(breadcrumbTestId: string): string {
  return `[data-testid="${escapeAttributeValue(breadcrumbTestId)}"]`
}

// The breadcrumb's last-item label is now rendered by `<EditableLabel>`
// (see `components/EditableLabel`). In read mode the wrapper has class
// `ecui-editable-label` without `--editing`; in edit mode `--editing`
// is added and an `input.ecui-editable-label-input` appears inside.
// Selectors target the editable-label classes rather than the old
// breadcrumb-scoped ones so the test helpers survive future relayouts
// of the wrapper's breadcrumb-specific class list.
export function breadcrumbLastLabelSelector(breadcrumbTestId: string): string {
  return `${breadcrumbRootSelector(breadcrumbTestId)} li.ecui-breadcrumb-item--last .ecui-editable-label:not(.ecui-editable-label--editing)`
}

export function breadcrumbEditInputSelector(breadcrumbTestId: string): string {
  return `${breadcrumbRootSelector(breadcrumbTestId)} input.ecui-editable-label-input`
}

export function breadcrumbNonLastItemsSelector(breadcrumbTestId: string): string {
  return `${breadcrumbRootSelector(breadcrumbTestId)} li.ecui-breadcrumb-item:not(.ecui-breadcrumb-item--last) button.ecui-breadcrumb-link`
}
