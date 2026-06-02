/**
 * Cross-platform undo / redo keyboard matchers, owned here so every consumer
 * gets the same platform-correct mapping:
 *   - Windows: Ctrl+Z (undo), Ctrl+Y (redo)
 *   - Linux:   Ctrl+Z (undo), Ctrl+Shift+Z (redo)
 *   - macOS:   Cmd+Z (undo), Cmd+Shift+Z (redo)
 *
 * The combos are disjoint, so a single matcher covers every platform without
 * branching: undo is (Ctrl|Cmd)+Z (no Shift), redo is (Ctrl|Cmd)+Shift+Z OR
 * Ctrl+Y. Callers feed a native KeyboardEvent.
 */
export function isUndoKeyEvent(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z'
}

export function isRedoKeyEvent(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  return (
    (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'z') ||
    (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'y')
  )
}
