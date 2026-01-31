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
