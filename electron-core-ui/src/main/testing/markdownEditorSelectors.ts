export function markdownEditorRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function markdownEditorMilkdownRootSelector(testId: string): string {
  return `[data-testid="${testId}-root"]`
}

export function markdownEditorContentEditableSelector(testId: string): string {
  return `[data-testid="${testId}"] .milkdown .editor[data-testid="${testId}-editor"]`
}
