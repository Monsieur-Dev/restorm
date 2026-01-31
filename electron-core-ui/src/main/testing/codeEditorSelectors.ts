function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function codeEditorRootSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}"]`
}

export function codeEditorMonacoContainerSelector(testId: string): string {
  return `[data-testid="${escapeAttributeValue(testId)}-monaco"]`
}

export function codeEditorTextareaSelector(testId: string): string {
  // Prefer the stable hook set by CodeEditor on mount.
  // Fallback to any textarea under the root.
  return `[data-testid="${escapeAttributeValue(testId)}-textarea"], ${codeEditorRootSelector(testId)} textarea`
}

export function codeEditorResolvedThemeAttrSelector(testId: string): string {
  return codeEditorRootSelector(testId)
}
