function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function dateTimePickerRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function dateTimePickerInputSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-input"]`
}

export function dateTimePickerOpenSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-open"]`
}

export function dateTimePickerTargetSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-target"]`
}

export function dateTimePickerPopoverSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-popover"]`
}

export function dateTimePickerMonthLabelSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-month-label"]`
}

export function dateTimePickerPrevMonthSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-prev-month"]`
}

export function dateTimePickerNextMonthSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-next-month"]`
}

export function dateTimePickerDaySelector(testId: string, isoDay: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-day-${escapeAttributeValue(isoDay)}"]`
}

export function dateTimePickerIncludeTimeSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-include-time"]`
}

export function dateTimePickerHoursSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-hours"]`
}

export function dateTimePickerMinutesSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-minutes"]`
}

export function dateTimePickerOutputModeSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-output-mode"]`
}

export function dateTimePickerPatternSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-pattern"]`
}

export function dateTimePickerPreviewValueSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-preview-value"]`
}
