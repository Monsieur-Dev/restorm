import { codeEditorTextareaSelector } from './codeEditorSelectors'

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function variableInputBoxRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function variableInputBoxEditorSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-editor"]`
}

export function variableInputBoxCodeEditorSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-codeeditor"]`
}

export function variableInputBoxTextareaSelector(testId: string): string {
  return codeEditorTextareaSelector(`${testId}-codeeditor`)
}

export function variableInputBoxContextMenuSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-contextmenu"]`
}

/**
 * Monaco's `{{...}}` suggest popup while it is open. The input sets
 * `fixedOverflowWidgets` + `overflowWidgetsDomNode: document.body`, so the
 * popup is reparented onto `document.body` rather than living under the
 * input's own root — it is NOT reachable from
 * `variableInputBoxRootSelector(testId)`, and there is no per-instance test
 * id on it. Match it on the page and, when more than one input could have
 * opened it, assert on the count rather than trying to attribute it.
 */
export const variableInputBoxSuggestWidgetSelector = '.suggest-widget.visible'
