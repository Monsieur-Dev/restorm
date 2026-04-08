export interface MouseSelectionSnapshot {
  anchorLine: number
  anchorColumn: number
  activeLine: number
  activeColumn: number
  isEmpty: boolean
}

export interface RestoreMouseSelectionParams {
  isMouseDown: boolean
  source: string | undefined
  currentSelection: MouseSelectionSnapshot
  lastGoodMouseSelection: MouseSelectionSnapshot | null
}

export function shouldRestoreMouseSelection({
  isMouseDown,
  source,
  currentSelection,
  lastGoodMouseSelection
}: RestoreMouseSelectionParams): boolean {
  if (!isMouseDown) return false
  if (source === 'mouse') return false
  if (!lastGoodMouseSelection) return false
  if (!currentSelection.isEmpty) return false

  const selectionCollapsedToAnotherCaret =
    currentSelection.anchorLine !== lastGoodMouseSelection.anchorLine ||
    currentSelection.anchorColumn !== lastGoodMouseSelection.anchorColumn ||
    currentSelection.activeLine !== lastGoodMouseSelection.activeLine ||
    currentSelection.activeColumn !== lastGoodMouseSelection.activeColumn

  return selectionCollapsedToAnotherCaret
}
