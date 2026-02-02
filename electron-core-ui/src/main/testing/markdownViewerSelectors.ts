export function markdownViewerRootSelector(testId: string): string {
  return `[data-testid="${testId}"]`
}

export function markdownViewerCodeBlockSelector(testId: string, index: number): string {
  return `[data-testid="${testId}-codeblock-${index}"]`
}

export function markdownViewerCodeBlockCopySelector(testId: string, index: number): string {
  return `[data-testid="${testId}-codeblock-${index}-copy"]`
}

export function markdownViewerMermaidSelector(testId: string, index: number): string {
  return `[data-testid="${testId}-mermaid-${index}"]`
}

export function markdownViewerLinkSelector(testId: string, index: number): string {
  return `[data-testid="${testId}-link-${index}"]`
}
